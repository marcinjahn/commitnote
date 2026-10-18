import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { ForgeError } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type { CommitRequest } from "../forge/forge-adapter";
import { IMAGE_INDEX_PATH, IMAGES_DIR } from "../format/v1";
import { type ImageId, imageFilePath } from "../images/image-id";
import { type ImageIndex, readImageIndex } from "../images/image-index";
import { formatImageReference } from "../images/image-reference";
import { createPendingImage, type PendingImage } from "../images/pending-image";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import {
  IDEAS,
  mainContent,
  okCommitCount,
  pushRemote,
  replaceLine,
  settle,
  WELCOME,
  welcomeText,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";
import { createSyncEngine, type SyncEngine } from "./sync-engine";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
}

async function setup(): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter({ withoutImageFiles: true });
  const commits: CommitRequest[] = [];
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({
    adapter: delegateAdapter(fake, {
      commit: (request) => {
        commits.push(request);
        return fake.commit(request);
      },
    }),
    keyring,
    clock,
  });
  await engine.refresh();
  return { fake, clock, engine, commits };
}

function newImage(): Promise<PendingImage> {
  return createPendingImage(keyring, {
    type: "image/webp",
    width: 4,
    height: 3,
    bytes: Uint8Array.from({ length: 64 }, (_, i) => i),
  });
}

function withReference(text: string, imageId: ImageId): string {
  return `${text}\n\n${formatImageReference({ imageId, alt: "Diagram", width: 4, height: 3 })}\n`;
}

function head(h: Harness): string {
  return h.fake.repo.getRef("main")!;
}

function imageFileAtHead(h: Harness, imageId: ImageId): string | undefined {
  return h.fake.repo.fileAt(head(h), imageFilePath(imageId));
}

async function indexAtHead(h: Harness): Promise<ImageIndex> {
  return readImageIndex(await h.fake.listTree(head(h)), keyring, (sha) =>
    h.fake.readBlob(sha),
  );
}

function lastCommit(h: Harness): CommitRequest {
  return h.commits.at(-1)!;
}

// Commits Welcome referencing a fresh pending image.
async function committedImage(
  h: Harness,
): Promise<{ readonly image: PendingImage; readonly original: string }> {
  const original = await welcomeText(h.fake);
  const image = await newImage();
  h.engine.addPendingImage(image);
  h.engine.editNote(WELCOME, withReference(original, image.imageId));
  expect(await h.engine.flush()).toEqual({ kind: "saved" });
  return { image, original };
}

describe("sync engine images", () => {
  it("saving a note in a repo without images writes no image index or image files", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "plain text");

    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    const paths = (await h.fake.listTree(head(h))).map((entry) => entry.path);
    expect(paths).not.toContain(IMAGE_INDEX_PATH);
    expect(paths.filter((path) => path.startsWith(`${IMAGES_DIR}/`))).toEqual(
      [],
    );
  });

  it("commits a referenced pending image with its index in one commit and then drops it", async () => {
    const h = await setup();
    const base = head(h);
    const image = await newImage();

    h.engine.addPendingImage(image);
    h.clock.advance(60_000);
    await settle(h.engine);
    expect(head(h)).toBe(base);
    expect(h.engine.getPendingImage(image.imageId)).toBe(image);

    h.engine.editNote(
      WELCOME,
      withReference(await welcomeText(h.fake), image.imageId),
    );
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(okCommitCount(h.fake, base)).toBe(1);
    expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
    expect(h.fake.repo.getBlobBytes(image.blobSha)).toEqual(image.envelope);
    expect(h.fake.repo.fileAt(head(h), IMAGE_INDEX_PATH)).toBeDefined();
    expect((await indexAtHead(h)).images.get(image.imageId)).toEqual({
      blobSha: image.blobSha,
      owners: [{ state: "active", path: WELCOME }],
    });
    expect(h.engine.getPendingImage(image.imageId)).toBeUndefined();
  });

  it("an edit referencing a pending image counts as unsaved, and a failed commit keeps the image for the retry", async () => {
    const h = await setup();
    const image = await newImage();
    h.engine.addPendingImage(image);
    h.engine.editNote(
      WELCOME,
      withReference(await welcomeText(h.fake), image.imageId),
    );

    h.fake.failNext("commit", new ForgeError("Server"));
    expect(await h.engine.flush()).toEqual({ kind: "unsaved", count: 1 });
    expect(h.engine.getState().syncStates.hasUnsaved).toBe(true);
    expect(h.engine.getPendingImage(image.imageId)).toBe(image);
    expect(imageFileAtHead(h, image.imageId)).toBeUndefined();

    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
    expect(h.engine.getPendingImage(image.imageId)).toBeUndefined();
  });

  it.each([
    [
      "a stale commit",
      async (h: Harness) => h.fake.failNext("commit", "stale"),
    ],
    [
      "a remote push",
      async (h: Harness) => {
        const ideas = await mainContent(h.fake, IDEAS);
        await pushRemote(
          h.fake,
          [{ kind: "update-note", path: IDEAS, content: `${ideas}\nremote` }],
          undefined,
          { now: h.clock.now() },
        );
      },
    ],
  ])(
    "commits the pending image on the retry after %s",
    async (_, interfere) => {
      const h = await setup();
      const image = await newImage();
      h.engine.addPendingImage(image);
      h.engine.editNote(
        WELCOME,
        withReference(await welcomeText(h.fake), image.imageId),
      );
      await interfere(h);

      expect(await h.engine.flush()).toEqual({ kind: "saved" });

      expect(h.commits.length).toBeGreaterThanOrEqual(2);
      expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
      expect((await indexAtHead(h)).images.has(image.imageId)).toBe(true);
      expect(h.engine.getPendingImage(image.imageId)).toBeUndefined();
    },
  );

  it("removing the reference deletes the file with a tombstone, and adding it back revives the same blob", async () => {
    const h = await setup();
    const { image, original } = await committedImage(h);

    h.engine.editNote(WELCOME, original);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(imageFileAtHead(h, image.imageId)).toBeUndefined();
    const removed = await indexAtHead(h);
    expect(removed.images.has(image.imageId)).toBe(false);
    expect(removed.tombstones.get(image.imageId)?.blobSha).toBe(image.blobSha);

    h.engine.editNote(WELCOME, withReference(original, image.imageId));
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(lastCommit(h).changes).toContainEqual({
      kind: "upsert-blob",
      path: imageFilePath(image.imageId),
      blobSha: image.blobSha,
    });
    expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
    expect((await indexAtHead(h)).tombstones.has(image.imageId)).toBe(false);
  });

  it("keeps the image when another device adds an owner while a local edit removes one", async () => {
    const h = await setup();
    const { image, original } = await committedImage(h);
    const ideas = await mainContent(h.fake, IDEAS);
    await pushRemote(
      h.fake,
      [
        {
          kind: "update-note",
          path: IDEAS,
          content: withReference(ideas!, image.imageId),
        },
      ],
      undefined,
      { now: h.clock.now() },
    );

    h.engine.editNote(WELCOME, original);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
    const index = await indexAtHead(h);
    expect(index.images.get(image.imageId)?.owners).toEqual([
      { state: "active", path: IDEAS },
    ]);
    expect(index.tombstones.has(image.imageId)).toBe(false);
  });

  it("deletes the file once when both devices remove the reference", async () => {
    const h = await setup();
    const { image, original } = await committedImage(h);
    await pushRemote(
      h.fake,
      [{ kind: "update-note", path: WELCOME, content: original }],
      undefined,
      { now: h.clock.now() },
    );
    const remoteHead = head(h);
    expect(h.fake.repo.fileAt(remoteHead, imageFilePath(image.imageId))).toBe(
      undefined,
    );

    h.engine.editNote(
      WELCOME,
      replaceLine(original, "# Welcome", "# Welcome (mine)"),
    );
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(head(h)).not.toBe(remoteHead);
    expect(lastCommit(h).changes.map((change) => change.path)).not.toContain(
      imageFilePath(image.imageId),
    );
    expect(imageFileAtHead(h, image.imageId)).toBeUndefined();
    const index = await indexAtHead(h);
    expect(index.images.has(image.imageId)).toBe(false);
    expect(index.tombstones.get(image.imageId)?.blobSha).toBe(image.blobSha);
  });

  it("purging a trashed note deletes its image file", async () => {
    const h = await setup();
    const { image } = await committedImage(h);
    const trashed = h.engine.delete(WELCOME);
    if (!trashed.ok) throw new Error("expected trashed");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
    expect((await indexAtHead(h)).images.get(image.imageId)?.owners).toEqual([
      { state: "trashed", entryId: trashed.trashEntryId, path: [] },
    ]);

    h.engine.deleteFromTrash([trashed.trashEntryId!]);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(lastCommit(h).changes).toContainEqual({
      kind: "delete",
      path: imageFilePath(image.imageId),
    });
    expect(imageFileAtHead(h, image.imageId)).toBeUndefined();
    expect((await indexAtHead(h)).images.has(image.imageId)).toBe(false);
  });

  it("restoring a trashed note keeps its image file", async () => {
    const h = await setup();
    const { image } = await committedImage(h);
    const trashed = h.engine.delete(WELCOME);
    if (!trashed.ok) throw new Error("expected trashed");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(h.engine.undoTrash(trashed.trashEntryId!).ok).toBe(true);
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(imageFileAtHead(h, image.imageId)).toBe(image.blobSha);
    expect((await indexAtHead(h)).images.get(image.imageId)?.owners).toEqual([
      { state: "active", path: WELCOME },
    ]);
  });

  it("revives a restored image from its blob sha", async () => {
    const h = await setup();
    const image = await newImage();
    const blobSha = await h.fake.repo.putBlobBytes(image.envelope);

    h.engine.addRestoredImages(new Map([[image.imageId, blobSha]]));
    h.engine.editNote(
      WELCOME,
      withReference(await welcomeText(h.fake), image.imageId),
    );
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    expect(lastCommit(h).changes).toContainEqual({
      kind: "upsert-blob",
      path: imageFilePath(image.imageId),
      blobSha,
    });
    expect(imageFileAtHead(h, image.imageId)).toBe(blobSha);
    expect((await indexAtHead(h)).images.get(image.imageId)?.blobSha).toBe(
      blobSha,
    );
  });

  it("dispose drops pending images", async () => {
    const h = await setup();
    const image = await newImage();
    h.engine.addPendingImage(image);

    h.engine.dispose();

    expect(h.engine.getPendingImage(image.imageId)).toBeUndefined();
  });
});
