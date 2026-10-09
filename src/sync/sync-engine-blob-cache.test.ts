import { beforeAll, describe, expect, it } from "vitest";
import { NoteDecryptionError } from "../crypto/note-cipher";
import type { Keyring } from "../crypto/keyring";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { createSyncEngine, type CachedBlobReader, type SyncEngine } from "./sync-engine";
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
