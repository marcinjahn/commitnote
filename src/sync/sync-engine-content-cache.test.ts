import { beforeAll, describe, expect, it } from "vitest";
import { createRepoConfig, type Keyring } from "../crypto/keyring";
import { sharedMemoizedArgon2id } from "../crypto/testing/shared-argon2id";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { REPO_CONFIG_PATH } from "../format/v1";
import {
  sampleNotesRepoConfig,
  sampleNotesRepoKeyring,
} from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { notePathEquals } from "../changes/change";
import { findNode, type FolderNode, type NoteNode } from "../tree/note-tree";
import {
  createNoteContentCache,
  type NoteContentCache,
} from "./note-content-cache";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { createTestClock } from "./testing/test-clock";

const WELCOME = ["Welcome"];
const OTHER = ["Zażółć gęślą jaźń"];

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
});

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly engine: SyncEngine;
  readonly cache: NoteContentCache;
  readonly reads: string[];
  holdReads(): () => void;
}

async function setup(capacity?: number): Promise<Harness> {
  const fake = await createSampleNotesRepoAdapter();
  const reads: string[] = [];
  let gate: Promise<void> | null = null;
  const adapter = delegateAdapter(fake, {
    readBlob: async (sha) => {
      reads.push(sha);
      if (gate !== null) await gate;
      return fake.readBlob(sha);
    },
  });
  const cache = createNoteContentCache(capacity);
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock: createTestClock(1_000_000),
    noteContentCache: cache,
  });
  await engine.refresh();
  return {
    fake,
    engine,
    cache,
    reads,
    holdReads() {
      let release!: () => void;
      gate = new Promise((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });
      return release;
    },
  };
}

function blobShaOf(engine: SyncEngine, path: string[]): string {
  const node = findNode(engine.getState().synced!.tree, path);
  if (node?.kind !== "note") throw new Error("expected a note");
  return node.blobSha;
}

function firstOtherNote(folder: FolderNode): NoteNode | undefined {
  for (const node of folder.children) {
    if (node.kind === "folder") {
      const found = firstOtherNote(node);
      if (found !== undefined) return found;
    } else if (
      !notePathEquals(node.path, WELCOME) &&
      !notePathEquals(node.path, OTHER)
    ) {
      return node;
    }
  }
  return undefined;
}

describe("note content cache in the sync engine", () => {
  it("reopens a cached note synchronously without reading its blob", async () => {
    const h = await setup();
    await h.engine.openNote(WELCOME);
    await h.engine.openNote(OTHER);
    const readsBefore = h.reads.length;

    const kinds: string[] = [];
    h.engine.subscribe((state) => {
      if (state.openNote !== null) kinds.push(state.openNote.kind);
    });
    kinds.length = 0;

    const pending = h.engine.openNote(WELCOME);
    const open = h.engine.getState().openNote;
    expect(open?.kind).toBe("loaded");
    if (open?.kind === "loaded") {
      expect(open.blobSha).toBe(blobShaOf(h.engine, WELCOME));
      expect(open.content.startsWith("# Welcome")).toBe(true);
    }
    await pending;

    expect(kinds).not.toContain("loading");
    expect(h.reads.length).toBe(readsBefore);
  });

  it("reads an evicted blob again", async () => {
    const h = await setup(1);
    await h.engine.openNote(WELCOME);
    await h.engine.openNote(OTHER);
    const readsBefore = h.reads.length;

    const pending = h.engine.openNote(WELCOME);
    expect(h.engine.getState().openNote?.kind).toBe("loading");
    await pending;

    expect(h.reads.length).toBe(readsBefore + 1);
  });

  it("keeps background reads out of the cache", async () => {
    const h = await setup(2);
    await h.engine.openNote(WELCOME);
    await h.engine.openNote(OTHER);
    const third = firstOtherNote(h.engine.getState().synced!.tree.root);
    if (third === undefined) throw new Error("expected a third note");
    await h.engine.readNoteText(third.blobSha);
    const readsBefore = h.reads.length;

    const pending = h.engine.openNote(WELCOME);
    const open = h.engine.getState().openNote;
    expect(open?.kind).toBe("loaded");
    if (open?.kind === "loaded") {
      expect(open.blobSha).toBe(blobShaOf(h.engine, WELCOME));
    }
    await pending;

    expect(h.reads.length).toBe(readsBefore);
  });

  it("is cleared on dispose", async () => {
    const h = await setup();
    await h.engine.openNote(WELCOME);
    const sha = blobShaOf(h.engine, WELCOME);
    expect(h.cache.get(sha)).toBeDefined();

    h.engine.dispose();

    expect(h.cache.get(sha)).toBeUndefined();
  });

  it("is cleared when the engine stops for a key change", async () => {
    const h = await setup();
    await h.engine.openNote(WELCOME);
    const sha = blobShaOf(h.engine, WELCOME);
    const rekeyed = (
      await createRepoConfig("another passphrase", {
        argon2id: sharedMemoizedArgon2id,
        kdf: sampleNotesRepoConfig().kdf,
      })
    ).configText;
    await h.fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: REPO_CONFIG_PATH, text: rekeyed },
    ]);

    await h.engine.refresh();

    expect(h.engine.getState().stopped).toEqual({ kind: "keyChanged" });
    expect(h.cache.get(sha)).toBeUndefined();
  });

  it("still drops a stale uncached load after a synchronous cached open", async () => {
    const h = await setup();
    await h.engine.openNote(OTHER);
    const release = h.holdReads();

    const staleLoad = h.engine.openNote(WELCOME);
    expect(h.engine.getState().openNote?.kind).toBe("loading");
    h.engine.openNote(OTHER);
    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      path: OTHER,
    });

    release();
    await staleLoad;

    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      path: OTHER,
    });
  });

  it("caches a saved note's new blob so re-resolving does not read it", async () => {
    const h = await setup();
    await h.engine.openNote(WELCOME);
    h.engine.editNote(WELCOME, "# Saved text\n");
    await h.engine.flush();
    const sha = blobShaOf(h.engine, WELCOME);
    expect(h.cache.get(sha)).toBe("# Saved text\n");
    const readsBefore = h.reads.length;

    await h.engine.openNote(OTHER);
    await h.engine.openNote(WELCOME);

    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      blobSha: sha,
      content: "# Saved text\n",
    });
    expect(h.reads).not.toContain(sha);
    expect(h.reads.length).toBe(readsBefore + 1);
  });

  it("drops a saved note's superseded content from the cache", async () => {
    const h = await setup(2);
    await h.engine.openNote(OTHER);
    await h.engine.openNote(WELCOME);
    h.engine.editNote(WELCOME, "# First edit\n");
    await h.engine.flush();
    h.engine.editNote(WELCOME, "# Second edit\n");
    await h.engine.flush();
    const readsBefore = h.reads.length;
    const otherSha = blobShaOf(h.engine, OTHER);

    const opening = h.engine.openNote(OTHER);

    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      blobSha: otherSha,
    });
    await opening;
    expect(h.reads.length).toBe(readsBefore);
  });
});
