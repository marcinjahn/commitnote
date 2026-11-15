import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CachedTree } from "../blob-cache/cached-tree";
import { createRepoConfig, type Keyring } from "../crypto/keyring";
import { NoteDecryptionError } from "../crypto/note-cipher";
import { sharedMemoizedArgon2id } from "../crypto/testing/shared-argon2id";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import {
  sampleNotesRepoConfig,
  sampleNotesRepoKeyring,
} from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createSyncEngine, type CachedBlobReader, type SyncEngine } from "./sync-engine";
import {
  mainContent,
  pushRemote,
  replaceLine,
  settle,
  WELCOME,
  welcomeText,
} from "./testing/engine-harness";
import { createTestClock } from "./testing/test-clock";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

async function setup(blobCache?: CachedBlobReader) {
  const fake = await createSampleNotesRepoAdapter();
  const reads: string[] = [];
  const adapter = delegateAdapter(fake, {
    readBlob: (sha) => {
      reads.push(sha);
      return fake.readBlob(sha);
    },
  });
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock: createTestClock(1_000_000),
    blobCache,
  });
  return { fake, adapter, engine, reads };
}

function noteBlobSha(engine: SyncEngine): string {
  const content = engine.searchSources()[0]!.content;
  if (content.kind !== "blob") throw new Error("expected a synced note");
  return content.blobSha;
}

async function firstNoteBlob(
  fake: Awaited<ReturnType<typeof createSampleNotesRepoAdapter>>,
  engine: SyncEngine,
): Promise<{ sha: string; ciphertext: string; text: string }> {
  await engine.refresh();
  const sha = noteBlobSha(engine);
  const text = await engine.readNoteText(sha);
  return { sha, ciphertext: await fake.readBlob(sha), text };
}

describe("sync engine cached reads", () => {
  it("resolves null without a blob cache and never reads the adapter", async () => {
    const h = await setup();
    await h.engine.refresh();
    h.reads.length = 0;
    const sha = noteBlobSha(h.engine);
    expect(await h.engine.readCachedNoteText(sha)).toBeNull();
    expect(h.reads).toEqual([]);
  });

  it("decrypts a cached blob with no adapter read", async () => {
    let held = "";
    const h = await setup({ read: async () => held });
    const note = await firstNoteBlob(h.fake, h.engine);
    held = note.ciphertext;
    h.reads.length = 0;
    expect(await h.engine.readCachedNoteText(note.sha)).toBe(note.text);
    expect(h.reads).toEqual([]);
  });

  it("resolves null on a cache miss with no adapter read", async () => {
    const h = await setup({ read: async () => null });
    await h.engine.refresh();
    h.reads.length = 0;
    const sha = noteBlobSha(h.engine);
    expect(await h.engine.readCachedNoteText(sha)).toBeNull();
    expect(h.reads).toEqual([]);
  });

  it("rejects like readNoteText when the cached ciphertext is corrupt", async () => {
    const h = await setup({ read: async () => "v1:AAAA" });
    await h.engine.refresh();
    const sha = noteBlobSha(h.engine);
    await expect(h.engine.readCachedNoteText(sha)).rejects.toBeInstanceOf(
      NoteDecryptionError,
    );
  });
});

describe("sync engine referenced blob shas", () => {
  it("is null before the first refresh", async () => {
    const h = await setup();
    expect(h.engine.referencedBlobShas()).toBeNull();
  });

  it("holds every blob of the synced listing", async () => {
    const h = await setup();
    await h.engine.refresh();
    const listing = await h.fake.listTree(await h.fake.getHead());
    const expected = new Set(
      listing.filter((e) => e.type === "blob").map((e) => e.sha),
    );
    expect(expected.size).toBeGreaterThan(h.engine.searchSources().length);
    expect(h.engine.referencedBlobShas()).toEqual(expected);
  });
});

async function snapshotOf(fake: FakeForgeAdapter): Promise<{
  readonly tree: CachedTree;
  readonly blobs: Map<string, string>;
}> {
  const head = await fake.getHead();
  const listing = await fake.listTree(head);
  const blobs = new Map<string, string>();
  for (const entry of listing) {
    if (entry.type === "blob") blobs.set(entry.sha, await fake.readBlob(entry.sha));
  }
  return { tree: { head, listing }, blobs };
}

async function setupRestore(engineKeyring?: Keyring) {
  const fake = await createSampleNotesRepoAdapter();
  const snapshot = await snapshotOf(fake);
  const calls: string[] = [];
  const adapter = delegateAdapter(fake, {
    getHead: () => {
      calls.push("getHead");
      return fake.getHead();
    },
    listTree: (sha) => {
      calls.push("listTree");
      return fake.listTree(sha);
    },
    readBlob: (sha) => {
      calls.push("readBlob");
      return fake.readBlob(sha);
    },
  });
  const engine = createSyncEngine({
    adapter,
    keyring: engineKeyring ?? keyring,
    clock: createTestClock(1_000_000),
    blobCache: { read: async (sha) => snapshot.blobs.get(sha) ?? null },
  });
  return { fake, engine, calls, snapshot };
}

describe("sync engine restoreCached", () => {
  it("builds the synced tree from the cache without asking the forge", async () => {
    const h = await setupRestore();
    expect(await h.engine.restoreCached(h.snapshot.tree)).toBe(true);
    expect(h.calls).toEqual([]);

    expect(h.engine.getState().synced?.head).toBe(h.snapshot.tree.head);
    await h.engine.openNote(WELCOME);
    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      content: await welcomeText(h.fake),
    });
  });

  it("starts nothing when a cached blob is missing", async () => {
    const h = await setupRestore();
    h.snapshot.blobs.clear();
    expect(await h.engine.restoreCached(h.snapshot.tree)).toBe(false);
    expect(h.engine.getState().synced).toBeNull();
  });

  it("starts nothing once synced from the forge", async () => {
    const h = await setupRestore();
    await h.engine.refresh();
    expect(await h.engine.restoreCached(h.snapshot.tree)).toBe(false);
  });

  it("starts nothing when the cached notes use another key", async () => {
    const other = await createRepoConfig("another passphrase", {
      argon2id: sharedMemoizedArgon2id,
      kdf: sampleNotesRepoConfig().kdf,
    });
    const h = await setupRestore(other.keyring);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await h.engine.restoreCached(h.snapshot.tree)).toBe(false);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("merges an edit of a stale cached note with the newer remote version", async () => {
    const h = await setupRestore();
    const original = await welcomeText(h.fake);
    const theirs = replaceLine(original, "# Welcome", "# Welcome (theirs)");
    await pushRemote(h.fake, [
      { kind: "update-note", path: WELCOME, content: theirs },
    ]);

    await h.engine.restoreCached(h.snapshot.tree);
    await h.engine.openNote(WELCOME);
    h.engine.editNote(WELCOME, `${original}\nmine\n`);
    await h.engine.refresh();
    await h.engine.flush();
    await settle(h.engine);

    const merged = await mainContent(h.fake, WELCOME);
    expect(merged).toContain("# Welcome (theirs)");
    expect(merged).toContain("\nmine\n");
    expect(h.engine.getState().conflicts).toEqual([]);
  });
});
