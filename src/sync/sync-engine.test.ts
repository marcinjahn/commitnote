import { beforeAll, describe, expect, it } from "vitest";
import { TAGS_PATH } from "../format/v1";
import {
  colorTagOf,
  encryptTagIndex,
  parseTagIndex,
  tagKey,
} from "../tags/tag-index";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { type Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ForgeError } from "../forge/errors";
import type { ForgeAdapter } from "../forge/forge-adapter";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import {
  sampleNotesRepoSource,
} from "../testing/sample-notes-repo/sample-source";
import { findNode, listNotes } from "../tree/note-tree";
import { createTestClock } from "./testing/test-clock";
import { findWorkingNode, type WorkingFolder } from "./working-tree";
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
  const adapter = delegateAdapter(inner, {
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
  });
  return { adapter, counts };
}

let keyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
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

  describe("remote-updated notice", () => {
    const remoteUpdates = (engine: SyncEngine) =>
      engine.getState().notices.filter((n) => n.kind === "remote-updated");

    it("is emitted once when another device changes the open loaded note", async () => {
      const { fake, engine } = await setup();
      await engine.refresh();
      await engine.openNote(["Welcome"]);
      const storedPath = await welcomeStoredPath(engine);

      await fake.pushFromAnotherDevice([
        {
          kind: "upsert-text",
          path: storedPath,
          text: await encryptNote(keyring, "# Welcome\n\nchanged elsewhere\n"),
        },
      ]);
      await engine.refresh();

      expect(remoteUpdates(engine)).toMatchObject([
        { kind: "remote-updated", path: ["Welcome"] },
      ]);
      await engine.refresh();
      expect(remoteUpdates(engine)).toHaveLength(1);
    });

    it("is not emitted for a change to another note", async () => {
      const { fake, engine } = await setup();
      await engine.refresh();
      await engine.openNote(["Welcome"]);

      await fake.pushFromAnotherDevice([
        {
          kind: "upsert-text",
          path: await encryptPath(keyring, ["Other"]),
          text: await encryptNote(keyring, "# Other\n"),
        },
      ]);
      await engine.refresh();

      expect(remoteUpdates(engine)).toHaveLength(0);
    });

    it("is not emitted when the open note has local work, and local content wins", async () => {
      const { fake, engine } = await setup();
      await engine.refresh();
      await engine.openNote(["Welcome"]);
      const storedPath = await welcomeStoredPath(engine);

      engine.editNote(["Welcome"], "local edit");
      await fake.pushFromAnotherDevice([
        {
          kind: "upsert-text",
          path: storedPath,
          text: await encryptNote(keyring, "# Welcome\n\nremote\n"),
        },
      ]);
      await engine.refresh();

      expect(remoteUpdates(engine)).toHaveLength(0);
      const open = engine.getState().openNote;
      expect(open).toMatchObject({ kind: "loaded", content: "local edit" });
    });
  });

  it("lists the working tree in the stored order and reads the order file once per version", async () => {
    const { fake, counts, engine } = await setup();
    await engine.refresh();

    const commitnoteFolder = () =>
      findWorkingNode(engine.getState().workingTree!, [
        "Projects",
        "commitnote",
      ]) as WorkingFolder;
    expect(commitnoteFolder().children.map((child) => child.name)).toEqual([
      "Roadmap",
      "Ideas",
    ]);
    const readsAfterFirstLoad = counts.readBlob;

    await fake.pushFromAnotherDevice([
      {
        kind: "upsert-text",
        path: await encryptPath(keyring, ["New note"]),
        text: await encryptNote(keyring, "# New note\n"),
      },
    ]);
    await engine.refresh();

    expect(counts.readBlob).toBe(readsAfterFirstLoad);
    expect(commitnoteFolder().children.map((child) => child.name)).toEqual([
      "Roadmap",
      "Ideas",
    ]);
  });

  it("loads the tag index and reads the tags file once per version", async () => {
    const { fake, counts, engine } = await setup();
    await fake.pushFromAnotherDevice([
      {
        kind: "upsert-text",
        path: TAGS_PATH,
        text: await encryptTagIndex(
          keyring,
          parseTagIndex(
            JSON.stringify({
              version: 1,
              notes: { [tagKey(["Welcome"])]: { color: "red" } },
              trash: {},
            }),
          ),
        ),
      },
    ]);
    await engine.refresh();
    expect(colorTagOf(engine.getState().synced!.tags, ["Welcome"])).toBe("red");
    const readsAfterFirstLoad = counts.readBlob;

    await fake.pushFromAnotherDevice([
      {
        kind: "upsert-text",
        path: await encryptPath(keyring, ["New note"]),
        text: await encryptNote(keyring, "# New note\n"),
      },
    ]);
    await engine.refresh();

    expect(counts.readBlob).toBe(readsAfterFirstLoad);
    expect(colorTagOf(engine.getState().synced!.tags, ["Welcome"])).toBe("red");
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
      "commitnote",
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

describe("snapshotNotes", () => {
  function sampleMarkdown(name: string): string {
    const entry = sampleNotesRepoSource.find((e) => e.name === name);
    if (entry?.kind !== "note") throw new Error("expected a sample note");
    return entry.markdown;
  }

  it("returns null before the first refresh", async () => {
    const { engine } = await setup();

    expect(engine.snapshotNotes()).toBeNull();
  });

  it("reads synced notes and unsaved local notes as they were when taken", async () => {
    const { engine } = await setup();
    await engine.refresh();
    const created = engine.createNote([], "Draft");
    if (!created.ok) throw new Error("expected the note to be created");
    engine.editNote(created.path, "first");

    const snapshot = engine.snapshotNotes();
    engine.editNote(created.path, "second");

    expect(snapshot?.tree.root.children.map((child) => child.name)).toContain(
      "Draft",
    );
    expect(await snapshot?.readNote(["Draft"])).toBe("first");
    expect(await snapshot?.readNote(["Welcome"])).toBe(
      sampleMarkdown("Welcome"),
    );
    engine.dispose();
  });
});
