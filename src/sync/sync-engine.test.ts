import { beforeAll, describe, expect, it } from "vitest";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import { parseRepoConfig } from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ForgeError } from "../forge/errors";
import type { ForgeAdapter } from "../forge/forge-adapter";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import { findNode, listNotes } from "../tree/note-tree";
import { createTestClock } from "./testing/test-clock";
import {
  createSyncEngine,
  type OpenNoteState,
  type SyncEngine,
  type SyncEngineState,
} from "./sync-engine";

interface CallCounts {
  getHead: number;
  listTree: number;
  readBlob: number;
}

function wrapWithCounts(inner: ForgeAdapter): {
  readonly adapter: ForgeAdapter;
  readonly counts: CallCounts;
} {
  const counts: CallCounts = { getHead: 0, listTree: 0, readBlob: 0 };
  const adapter: ForgeAdapter = {
    inspect: () => inner.inspect(),
    initialize: (configText, message) => inner.initialize(configText, message),
    getHead: () => {
      counts.getHead++;
      return inner.getHead();
    },
    listTree: (commitSha) => {
      counts.listTree++;
      return inner.listTree(commitSha);
    },
    readBlob: (sha) => {
      counts.readBlob++;
      return inner.readBlob(sha);
    },
    commit: (request) => inner.commit(request),
  };
  return { adapter, counts };
}

let keyring: Keyring;

beforeAll(async () => {
  const probe = await createSampleNotesRepoAdapter();
  const inspection = await probe.inspect();
  if (inspection.kind !== "populated" || inspection.main === null) {
    throw new Error("expected a populated sample notes repo");
  }
  const repoConfigText = inspection.main.repoConfigText;
  if (repoConfigText === null) {
    throw new Error("expected a repo config");
  }
  const parsed = parseRepoConfig(repoConfigText);
  if (parsed.kind !== "valid") {
    throw new Error(`expected a valid repo config, got ${parsed.kind}`);
  }
  keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    argon2idDirect,
  );
});

async function setup(): Promise<{
  readonly fake: FakeForgeAdapter;
  readonly counts: CallCounts;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
}> {
  const fake = await createSampleNotesRepoAdapter();
  const { adapter, counts } = wrapWithCounts(fake);
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({ adapter, keyring, clock });
  return { fake, counts, clock, engine };
}

async function welcomeStoredPath(engine: SyncEngine): Promise<string> {
  const tree = engine.getState().synced?.tree;
  if (tree === undefined) {
    throw new Error("expected a synced tree");
  }
  const node = findNode(tree, ["Welcome"]);
  if (node === undefined || node.kind !== "note") {
    throw new Error("expected to find the Welcome note");
  }
  return node.storedPath;
}

describe("createSyncEngine", () => {
  it("subscribe delivers the initial state immediately and every change after", async () => {
    const { engine } = await setup();
    const seen: SyncEngineState[] = [];
    const unsubscribe = engine.subscribe((state) => seen.push(state));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      synced: null,
      refresh: { inFlight: false, lastError: null, lastCompletedAt: null },
      openNote: null,
    });

    await engine.refresh();

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(engine.getState());
    unsubscribe();
  });

  it("first refresh sets the synced head and orders the root's children", async () => {
    const { fake, clock, engine } = await setup();

    await engine.refresh();

    const state = engine.getState();
    expect(state.synced?.head).toBe(await fake.getHead());
    expect(
      state.synced?.tree.root.children.map((child) => [child.kind, child.name]),
    ).toEqual([
      ["folder", "Empty folder"],
      ["folder", "Journal"],
      ["folder", "Projects"],
      ["note", "Welcome"],
      ["note", "Zażółć gęślą jaźń"],
    ]);
    expect(state.refresh.lastCompletedAt).toBe(clock.now());
  });

  it("does not reload the tree when a second refresh sees an unchanged head", async () => {
    const { counts, engine } = await setup();

    await engine.refresh();
    expect(counts.getHead).toBe(1);
    expect(counts.listTree).toBe(1);

    await engine.refresh();
    expect(counts.getHead).toBe(2);
    expect(counts.listTree).toBe(1);
  });

  it("reloads the tree after another device pushes a note, ignoring an unencrypted stray file", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();

    const storedPath = await encryptPath(keyring, ["New note"]);
    const content = await encryptNote(keyring, "# New note\n");
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: storedPath, text: content },
      {
        kind: "upsert-text",
        path: "stray.txt",
        text: "plain text, not encrypted",
      },
    ]);

    await engine.refresh();

    const tree = engine.getState().synced?.tree;
    if (tree === undefined) {
      throw new Error("expected a synced tree");
    }
    expect(findNode(tree, ["New note"])?.kind).toBe("note");
    expect(listNotes(tree).some((note) => note.name === "stray.txt")).toBe(
      false,
    );
  });

  it("two concurrent refresh() calls cause exactly one getHead", async () => {
    const { counts, engine } = await setup();

    const first = engine.refresh();
    const second = engine.refresh();
    expect(second).toBe(first);

    await Promise.all([first, second]);
    expect(counts.getHead).toBe(1);
  });

  it("openNote(['Welcome']) goes loading then loaded with the decrypted markdown", async () => {
    const { engine } = await setup();
    await engine.refresh();

    const pending = engine.openNote(["Welcome"]);
    expect(engine.getState().openNote).toEqual({
      kind: "loading",
      path: ["Welcome"],
    });

    await pending;

    const openNote = engine.getState().openNote;
    expect(openNote?.kind).toBe("loaded");
    if (openNote?.kind === "loaded") {
      expect(openNote.content.startsWith("# Welcome")).toBe(true);
    }
  });

  it("reloads the open note's content on refresh when another device changes its blob", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();
    await engine.openNote(["Welcome"]);
    const storedPath = await welcomeStoredPath(engine);

    const seenKinds: OpenNoteState["kind"][] = [];
    const unsubscribe = engine.subscribe((state) => {
      if (state.openNote !== null) seenKinds.push(state.openNote.kind);
    });

    const newContent = await encryptNote(keyring, "# Welcome (edited)\n");
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: storedPath, text: newContent },
    ]);
    await engine.refresh();
    unsubscribe();

    expect(seenKinds.every((kind) => kind === "loaded")).toBe(true);
    const openNote = engine.getState().openNote;
    expect(openNote?.kind).toBe("loaded");
    if (openNote?.kind === "loaded") {
      expect(openNote.content).toBe("# Welcome (edited)\n");
    }
  });

  it("leaves the open note unchanged on refresh when a different note changes", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();
    await engine.openNote(["Welcome"]);
    const before = engine.getState().openNote;

    const ideasPath = await encryptPath(keyring, [
      "Projects",
      "git-notes",
      "Ideas",
    ]);
    const newIdeas = await encryptNote(keyring, "# Ideas (edited)\n");
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: ideasPath, text: newIdeas },
    ]);
    await engine.refresh();

    expect(engine.getState().openNote).toBe(before);
  });

  it("marks the open note missing on refresh when another device deletes it", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();
    await engine.openNote(["Welcome"]);
    const storedPath = await welcomeStoredPath(engine);

    await fake.pushFromAnotherDevice([{ kind: "delete", path: storedPath }]);
    await engine.refresh();

    expect(engine.getState().openNote).toEqual({
      kind: "missing",
      path: ["Welcome"],
    });
  });

  it("openNote on a folder path or an unknown path resolves to missing", async () => {
    const { engine } = await setup();
    await engine.refresh();

    await engine.openNote(["Projects"]);
    expect(engine.getState().openNote).toEqual({
      kind: "missing",
      path: ["Projects"],
    });

    await engine.openNote(["Does not exist"]);
    expect(engine.getState().openNote).toEqual({
      kind: "missing",
      path: ["Does not exist"],
    });
  });

  it("maps a getHead failure to a network error, leaves synced unchanged, and clears it on the next success", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();
    const syncedBefore = engine.getState().synced;

    fake.failNext("getHead", new ForgeError("Network"));
    await engine.refresh();

    const afterFailure = engine.getState();
    expect(afterFailure.refresh.lastError).toEqual({ kind: "network" });
    expect(afterFailure.refresh.inFlight).toBe(false);
    expect(afterFailure.synced).toBe(syncedBefore);

    await engine.refresh();
    expect(engine.getState().refresh.lastError).toBeNull();
  });

  it("marks an open note failed with unauthorized when readBlob fails on an uncached blob", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();

    fake.failNext("readBlob", new ForgeError("Unauthorized"));
    await engine.openNote(["Welcome"]);

    expect(engine.getState().openNote).toEqual({
      kind: "failed",
      path: ["Welcome"],
      error: { kind: "unauthorized" },
    });
  });

  it("marks an open note failed with undecryptable when the stored blob isn't a valid note", async () => {
    const { fake, engine } = await setup();
    await engine.refresh();

    const storedPath = await encryptPath(keyring, ["Bad note"]);
    await fake.pushFromAnotherDevice([
      { kind: "upsert-text", path: storedPath, text: "not an encrypted note" },
    ]);
    await engine.refresh();

    await engine.openNote(["Bad note"]);

    expect(engine.getState().openNote).toEqual({
      kind: "failed",
      path: ["Bad note"],
      error: { kind: "undecryptable" },
    });
  });

  it("keeps only the result of the latest openNote call when two are in flight", async () => {
    const { engine } = await setup();
    await engine.refresh();

    const first = engine.openNote(["Welcome"]);
    const second = engine.openNote(["Zażółć gęślą jaźń"]);
    await Promise.all([first, second]);

    const openNote = engine.getState().openNote;
    expect(openNote?.kind).toBe("loaded");
    if (openNote?.kind === "loaded") {
      expect(openNote.path).toEqual(["Zażółć gęślą jaźń"]);
    }
  });

  it("stops notifying subscribers after dispose()", async () => {
    const { engine } = await setup();
    await engine.refresh();

    const seen: SyncEngineState[] = [];
    engine.subscribe((state) => seen.push(state));
    const countAtDispose = seen.length;

    engine.dispose();
    await engine.refresh();
    await engine.openNote(["Welcome"]);

    expect(seen).toHaveLength(countAtDispose);
  });

  it("ignores results of work already in flight when dispose() is called", async () => {
    const { engine } = await setup();
    await engine.refresh();

    const seen: SyncEngineState[] = [];
    engine.subscribe((state) => seen.push(state));

    const pending = engine.openNote(["Welcome"]);
    const countAtLoading = seen.length;
    engine.dispose();

    await pending;

    expect(seen).toHaveLength(countAtLoading);
    expect(engine.getState().openNote).toEqual({
      kind: "loading",
      path: ["Welcome"],
    });
  });
});
