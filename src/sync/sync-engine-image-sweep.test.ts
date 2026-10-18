import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { ForgeError } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { CommitRequest } from "../forge/forge-adapter";
import {
  FORMAT_VERSION,
  IMAGE_INDEX_PATH,
  IMAGES_DIR,
  SAVE_SUBJECT,
  TRAILER,
  TRASH_RETENTION_MS,
} from "../format/v1";
import { type ImageId, imageFilePath } from "../images/image-id";
import {
  encryptImageIndex,
  type ImageIndex,
  type ImageRecord,
  type ImageTombstone,
  readImageIndex,
} from "../images/image-index";
import type { RateBudget } from "./rate-budget";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { buildTrashIndex } from "../trash/trash-index";
import {
  fullBudget,
  IDEAS,
  mainContent,
  pushRemote,
  settle,
  WELCOME,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { MAX_IMAGE_SWEEP_FILES_PER_COMMIT } from "./tuning";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

const START = Date.UTC(2026, 8, 30, 12, 0, 0);
const EXPIRED_WELCOME = "20260801T100000Z-1-aaaaaaaa";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function id(n: number): ImageId {
  return (
    "q".repeat(23) +
    LETTERS[Math.floor(n / 676) % 26] +
    LETTERS[Math.floor(n / 26) % 26] +
    LETTERS[n % 26]
  );
}

const ORPHAN = id(0);
const INDEXED = id(1);
const TOMBSTONED = id(2);

interface Seed {
  readonly files?: readonly ImageId[];
  readonly images?: Readonly<Record<ImageId, ImageRecord>>;
  readonly tombstones?: Readonly<Record<ImageId, ImageTombstone>>;
}

function record(): ImageRecord {
  return {
    blobSha: "a".repeat(40),
    owners: [{ state: "active", path: IDEAS }],
  };
}

function tombstone(removedAt: number): ImageTombstone {
  return { blobSha: "b".repeat(40), removedAt };
}

async function seedImages(fake: FakeForgeAdapter, seed: Seed): Promise<void> {
  const index: ImageIndex = {
    writable: true,
    images: new Map(Object.entries(seed.images ?? {})),
    tombstones: new Map(Object.entries(seed.tombstones ?? {})),
  };
  await fake.pushFromAnotherDevice([
    ...(seed.files ?? []).map((imageId) => ({
      kind: "upsert-bytes" as const,
      path: imageFilePath(imageId),
      bytes: Uint8Array.of(1, 2, 3),
    })),
    ...(index.images.size > 0 || index.tombstones.size > 0
      ? [
          {
            kind: "upsert-text" as const,
            path: IMAGE_INDEX_PATH,
            text: await encryptImageIndex(keyring, index),
          },
        ]
      : []),
  ]);
}

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
}

async function setup(options?: {
  readonly seed?: Seed;
  readonly trash?: ChangeSet;
  readonly fake?: FakeForgeAdapter;
  readonly rateBudget?: (
    clock: ReturnType<typeof createTestClock>,
  ) => RateBudget;
  readonly beforeCommit?: (fake: FakeForgeAdapter) => Promise<void>;
}): Promise<Harness> {
  const clock = createTestClock(START);
  const fake = options?.fake ?? (await createSampleNotesRepoAdapter());
  if (options?.trash !== undefined) await pushRemote(fake, options.trash);
  if (options?.seed !== undefined) await seedImages(fake, options.seed);
  const commits: CommitRequest[] = [];
  const engine = createSyncEngine({
    adapter: delegateAdapter(fake, {
      commit: async (request) => {
        commits.push(request);
        await options?.beforeCommit?.(fake);
        return fake.commit(request);
      },
    }),
    keyring,
    clock,
    rateBudget: options?.rateBudget?.(clock),
  });
  await engine.refresh();
  return { fake, clock, engine, commits };
}

async function imageFiles(fake: FakeForgeAdapter): Promise<string[]> {
  return (await fake.listTree(await fake.getHead()))
    .filter((entry) => entry.path.startsWith(`${IMAGES_DIR}/`))
    .map((entry) => entry.path)
    .sort();
}

async function remoteIndex(fake: FakeForgeAdapter): Promise<ImageIndex> {
  return readImageIndex(
    await fake.listTree(await fake.getHead()),
    keyring,
    (sha) => fake.readBlob(sha),
  );
}

function deletedImagePaths(request: CommitRequest): string[] {
  return request.changes
    .filter(
      (change) =>
        change.kind === "delete" && change.path.startsWith(`${IMAGES_DIR}/`),
    )
    .map((change) => change.path);
}

const ORPHAN_SEED: Seed = {
  files: [ORPHAN, INDEXED, TOMBSTONED],
  images: { [INDEXED]: record() },
  tombstones: { [TOMBSTONED]: tombstone(START - 1_000) },
};

describe("sync engine orphan image sweep", () => {
  it("commits nothing in a repo without images", async () => {
    const h = await setup();

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
  });

  it("deletes only files neither indexed nor tombstoned, in one commit without change trailers", async () => {
    const h = await setup({ seed: ORPHAN_SEED });

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].changes).toEqual([
      { kind: "delete", path: imageFilePath(ORPHAN) },
    ]);
    expect(h.commits[0].message).toBe(
      `${SAVE_SUBJECT}\n\n${TRAILER.format}: ${FORMAT_VERSION}`,
    );
    expect(await imageFiles(h.fake)).toEqual(
      [imageFilePath(INDEXED), imageFilePath(TOMBSTONED)].sort(),
    );
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
    expect(h.engine.getState().syncStates.unsavedCount).toBe(0);
  });

  it("prunes expired tombstones and keeps a file whose tombstone just expired until the next sweep", async () => {
    const expired = START - TRASH_RETENTION_MS - 1;
    const h = await setup({
      seed: {
        files: [TOMBSTONED],
        images: { [INDEXED]: record() },
        tombstones: {
          [TOMBSTONED]: tombstone(expired),
          [ORPHAN]: tombstone(START - 1_000),
        },
      },
    });

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].changes.map((change) => change.path)).toEqual([
      IMAGE_INDEX_PATH,
    ]);
    const index = await remoteIndex(h.fake);
    expect([...index.tombstones.keys()]).toEqual([ORPHAN]);
    expect([...index.images.keys()]).toEqual([INDEXED]);
    expect(await imageFiles(h.fake)).toEqual([imageFilePath(TOMBSTONED)]);

    const next = await setup({ fake: h.fake });
    next.engine.sweepOrphanImages();
    await settle(next.engine);
    expect(next.commits).toHaveLength(1);
    expect(await imageFiles(h.fake)).toEqual([]);
  });

  it("deletes at most the per-commit maximum of files", async () => {
    const files = Array.from(
      { length: MAX_IMAGE_SWEEP_FILES_PER_COMMIT + 1 },
      (_, n) => id(n),
    );
    const h = await setup({ seed: { files } });

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(deletedImagePaths(h.commits[0])).toHaveLength(
      MAX_IMAGE_SWEEP_FILES_PER_COMMIT,
    );
    expect(await imageFiles(h.fake)).toHaveLength(1);
  });

  it("runs only once per engine", async () => {
    const h = await setup({ seed: ORPHAN_SEED });
    h.engine.sweepOrphanImages();
    await settle(h.engine);
    await seedImages(h.fake, { files: [id(5)] });
    await h.engine.refresh();

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(await imageFiles(h.fake)).toContain(imageFilePath(id(5)));
  });

  it("is skipped when the rate budget lacks headroom", async () => {
    const h = await setup({ seed: ORPHAN_SEED, rateBudget: fullBudget });

    h.engine.sweepOrphanImages();
    h.clock.advance(3_600_000);
    await settle(h.engine);

    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
  });

  it("is skipped after a failed refresh", async () => {
    const h = await setup({ seed: ORPHAN_SEED });
    h.fake.failNext("getHead", new ForgeError("Network"));
    await h.engine.refresh();
    expect(h.engine.getState().refresh.lastError).toEqual({ kind: "network" });

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(0);
  });

  it("is skipped while the image index is unreadable", async () => {
    const fake = await createSampleNotesRepoAdapter();
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: IMAGE_INDEX_PATH, text: "not an index" },
      {
        kind: "upsert-bytes",
        path: imageFilePath(ORPHAN),
        bytes: Uint8Array.of(1),
      },
    ]);
    const h = await setup({ fake });

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(0);
    expect(await imageFiles(h.fake)).toEqual([imageFilePath(ORPHAN)]);
  });

  it("shares one commit with the startup trash purge", async () => {
    const h = await setup({
      seed: ORPHAN_SEED,
      trash: [{ kind: "trash-note", path: WELCOME, entryId: EXPIRED_WELCOME }],
    });

    h.engine.purgeExpiredTrash();
    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(deletedImagePaths(h.commits[0])).toEqual([imageFilePath(ORPHAN)]);
    const listing = await h.fake.listTree(await h.fake.getHead());
    expect(await buildTrashIndex(listing, keyring)).toEqual([]);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
  });

  it("drops a failed sweep without a failed status, unsaved work or retries", async () => {
    const h = await setup({ seed: ORPHAN_SEED });
    h.fake.failNext("commit", new ForgeError("Network"));

    h.engine.sweepOrphanImages();
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    await settle(h.engine);
    h.clock.advance(600_000);
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    const state = h.engine.getState();
    expect(state.save).toEqual({ kind: "idle" });
    expect(state.pending).toEqual([]);
    expect(state.inFlight).toEqual([]);
    expect(await imageFiles(h.fake)).toContain(imageFilePath(ORPHAN));
  });

  it("re-encodes a sweep riding with an edit against a newer head, deleting only true orphans", async () => {
    const remoteImage = id(9);
    let pushed = false;
    const h = await setup({
      seed: ORPHAN_SEED,
      beforeCommit: async (fake) => {
        if (pushed) return;
        pushed = true;
        await seedImages(fake, {
          files: [remoteImage],
          images: { [INDEXED]: record(), [remoteImage]: record() },
          tombstones: { [TOMBSTONED]: tombstone(START - 1_000) },
        });
      },
    });
    h.engine.editNote(WELCOME, "local edit");

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(2);
    expect(deletedImagePaths(h.commits[1])).toEqual([imageFilePath(ORPHAN)]);
    expect(await imageFiles(h.fake)).toEqual(
      [
        imageFilePath(INDEXED),
        imageFilePath(TOMBSTONED),
        imageFilePath(remoteImage),
      ].sort(),
    );
    expect(await mainContent(h.fake, WELCOME, keyring)).toBe("local edit");
  });

  it("re-encodes a stale sweep-only attempt and leaves no sweep for the next save", async () => {
    const h = await setup({ seed: ORPHAN_SEED });
    h.fake.failNext("commit", "stale");

    h.engine.sweepOrphanImages();
    await settle(h.engine);

    expect(h.commits).toHaveLength(2);
    expect(deletedImagePaths(h.commits[1])).toEqual([imageFilePath(ORPHAN)]);
    expect(await imageFiles(h.fake)).not.toContain(imageFilePath(ORPHAN));

    await seedImages(h.fake, { files: [id(5)] });
    await h.engine.refresh();
    h.engine.editNote(WELCOME, "local edit");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(h.commits).toHaveLength(3);
    expect(deletedImagePaths(h.commits[2])).toEqual([]);
    expect(await imageFiles(h.fake)).toContain(imageFilePath(id(5)));
  });

  it("never counts an in-flight sweep as unsaved work", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await setup({ seed: ORPHAN_SEED, beforeCommit: () => gate });

    h.engine.sweepOrphanImages();
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));

    expect(h.engine.getState().syncStates.unsavedCount).toBe(0);
    expect(h.engine.getState().syncStates.hasUnsaved).toBe(false);
    release();
    await settle(h.engine);
  });
});
