import { beforeAll, describe, expect, it, vi } from "vitest";
import { encodeInitializeMessage } from "../changes/encode-change-set";
import { sharedMemoizedArgon2id } from "../crypto/testing/shared-argon2id";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import {
  createRepoConfig,
  type Keyring,
} from "../crypto/keyring";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ForgeError } from "../forge/errors";
import type { CommitRequest, ForgeAdapter } from "../forge/forge-adapter";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { FOLDER_MARKER, TRAILER } from "../format/v1";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { CONFLICT_MARKERS } from "../merge/merge-text";
import { findNode, type NoteTree } from "../tree/note-tree";
import { hasConflictMarkers } from "./sync-state";
import { createTestClock } from "./testing/test-clock";
import {
  IDEAS,
  WELCOME,
  ZAZOLC,
  drainAsync,
  mainContent,
  mainTree,
  okCommitCount,
  pushRemote,
  waitIdle,
} from "./testing/engine-harness";
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
  // Makes every following commit wait until the returned release is called.
  gateCommits(): () => void;
  // Makes every following blob read wait until the returned release is called.
  gateReads(): () => void;
}

function wrap(
  inner: FakeForgeAdapter,
  commits: CommitRequest[],
  gate: { current: Promise<void> | null },
  readGate: { current: Promise<void> | null },
): ForgeAdapter {
  return delegateAdapter(inner, {
    readBlob: async (sha) => {
      if (readGate.current !== null) await readGate.current;
      return inner.readBlob(sha);
    },
    commit: async (request) => {
      commits.push(request);
      if (gate.current !== null) await gate.current;
      return inner.commit(request);
    },
  });
}

async function setup(
  fake?: FakeForgeAdapter,
  engineKeyring?: Keyring,
): Promise<Harness> {
  const forge = fake ?? (await createSampleNotesRepoAdapter());
  const commits: CommitRequest[] = [];
  const gate: { current: Promise<void> | null } = { current: null };
  const readGate: { current: Promise<void> | null } = { current: null };
  const clock = createTestClock(1_000_000);
  const engine = createSyncEngine({
    adapter: wrap(forge, commits, gate, readGate),
    keyring: engineKeyring ?? keyring,
    clock,
  });
  await engine.refresh();
  return {
    fake: forge,
    clock,
    engine,
    commits,
    gateCommits() {
      let release!: () => void;
      gate.current = new Promise((resolve) => {
        release = () => {
          gate.current = null;
          resolve();
        };
      });
      return release;
    },
    gateReads() {
      let release!: () => void;
      readGate.current = new Promise((resolve) => {
        release = () => {
          readGate.current = null;
          resolve();
        };
      });
      return release;
    },
  };
}

function withoutTheirsSide(text: string): string {
  const lines: string[] = [];
  let skipping = false;
  for (const line of text.split("\n")) {
    if (line === CONFLICT_MARKERS.mine) continue;
    if (line === CONFLICT_MARKERS.separator) skipping = true;
    else if (line === CONFLICT_MARKERS.theirs) skipping = false;
    else if (!skipping) lines.push(line);
  }
  return lines.join("\n");
}

function messageOf(fake: FakeForgeAdapter, head: string): string {
  const commit = fake.repo.getCommit(head);
  if (commit === undefined) throw new Error("unknown commit");
  return commit.message;
}


async function welcomeText(fake: FakeForgeAdapter): Promise<string> {
  const text = await mainContent(fake, WELCOME);
  if (text === undefined) throw new Error("expected Welcome");
  return text;
}

function replaceLine(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`missing line ${from}`);
  return text.replace(from, to);
}

// Leaves a held conflict on Welcome: mine and theirs both rewrite its title.
async function heldWelcomeConflict(h: Harness): Promise<{
  readonly mine: string;
  readonly theirs: string;
  readonly remoteHead: string;
}> {
  const original = await welcomeText(h.fake);
  const mine = replaceLine(original, "# Welcome", "# Welcome (mine)");
  const theirs = replaceLine(original, "# Welcome", "# Welcome (theirs)");
  const remoteHead = await pushRemote(h.fake, [
    { kind: "update-note", path: WELCOME, content: theirs },
  ]);
  h.engine.editNote(WELCOME, mine);
  await h.engine.flush();
  return { mine, theirs, remoteHead };
}

describe("sync engine saves", () => {
  it("autosaves after the debounce and at the max wait during continuous edits", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    h.engine.editNote(WELCOME, "one");
    h.clock.advance(1_999);
    expect(h.engine.getState().save.kind).toBe("idle");
    expect(h.commits).toHaveLength(0);
    h.clock.advance(1);
    await waitIdle(h.engine);
    expect(h.commits).toHaveLength(1);
    expect(okCommitCount(h.fake, start)).toBe(1);

    const second = await setup();
    for (let index = 0; index < 29; index++) {
      second.engine.editNote(WELCOME, `edit ${index}`);
      second.clock.advance(1_000);
    }
    second.engine.editNote(WELCOME, "last");
    expect(second.commits).toHaveLength(0);
    second.clock.advance(1_000);
    await waitIdle(second.engine);
    expect(second.commits).toHaveLength(1);
    expect(await mainContent(second.fake, WELCOME)).toBe("last");
  });

  it("commits edits and a folder create as one format v1 commit with stored paths only", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    h.engine.editNote(WELCOME, "welcome secret text");
    h.engine.editNote(ZAZOLC, "zazolc secret text");
    expect(h.engine.createFolder([], "Plain folder name").ok).toBe(true);
    await waitIdle(h.engine);

    expect(okCommitCount(h.fake, start)).toBe(1);
    const head = await h.fake.getHead();
    const message = messageOf(h.fake, head);
    expect(message).toContain(`${TRAILER.format}: 1`);
    const trailers = message
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("Commitnote-") &&
          !line.startsWith(TRAILER.format) &&
          !line.startsWith(TRAILER.order),
      );
    expect(trailers).toHaveLength(3);
    for (const plaintext of [
      "Welcome",
      "Zażółć",
      "Plain folder name",
      "secret",
    ]) {
      expect(message).not.toContain(plaintext);
    }
    expect(await mainContent(h.fake, WELCOME)).toBe("welcome secret text");
    expect(await mainContent(h.fake, ZAZOLC)).toBe("zazolc secret text");
    expect(h.engine.getState().synced?.head).toBe(head);
  });

  it("commits each structure operation immediately with its trailer", async () => {
    const h = await setup();

    async function expectCommit(
      trailer: string,
      check: (tree: NoteTree) => void,
    ): Promise<void> {
      const before = h.commits.length;
      expect(h.engine.getState().save.kind).toBe("saving");
      await waitIdle(h.engine);
      expect(h.commits).toHaveLength(before + 1);
      const tree = await mainTree(h.fake);
      const head = await h.fake.getHead();
      expect(messageOf(h.fake, head)).toContain(`${trailer}: `);
      check(tree);
    }

    expect(h.engine.createNote([], "Fresh")).toEqual({
      ok: true,
      path: ["Fresh"],
    });
    await expectCommit(TRAILER.create, (tree) =>
      expect(findNode(tree, ["Fresh"])?.kind).toBe("note"),
    );

    h.engine.createFolder([], "Box");
    await expectCommit(TRAILER.create, (tree) =>
      expect(findNode(tree, ["Box"])?.kind).toBe("folder"),
    );
    const listing = await h.fake.listTree(await h.fake.getHead());
    const box = findNode(await mainTree(h.fake), ["Box"]);
    expect(
      listing.some(
        (entry) => entry.path === `${box?.storedPath}/${FOLDER_MARKER}`,
      ),
    ).toBe(true);

    h.engine.rename(WELCOME, "Hello");
    await expectCommit(TRAILER.rename, (tree) => {
      expect(findNode(tree, WELCOME)).toBeUndefined();
      expect(findNode(tree, ["Hello"])?.kind).toBe("note");
    });

    h.engine.rename(["Projects"], "Work");
    await expectCommit(TRAILER.rename, (tree) =>
      expect(findNode(tree, ["Work", "commitnote", "Ideas"])?.kind).toBe(
        "note",
      ),
    );

    expect(h.engine.move(["Hello"], ["Box"])).toEqual({
      ok: true,
      path: ["Box", "Hello"],
    });
    await expectCommit(TRAILER.rename, (tree) =>
      expect(findNode(tree, ["Box", "Hello"])?.kind).toBe("note"),
    );

    h.engine.delete(ZAZOLC);
    await expectCommit(TRAILER.trash, (tree) =>
      expect(findNode(tree, ZAZOLC)).toBeUndefined(),
    );

    h.engine.delete(["Empty folder"]);
    await expectCommit(TRAILER.delete, (tree) =>
      expect(findNode(tree, ["Empty folder"])).toBeUndefined(),
    );
  });

  it("rejects invalid names and move targets without saving", async () => {
    const h = await setup();
    const invalid = (kind: string, extra: object = {}) => ({
      ok: false,
      error: { kind: "invalidName", error: { kind, ...extra } },
    });

    expect(h.engine.createNote([], "  ")).toEqual(invalid("empty"));
    expect(h.engine.createNote([], "a/b")).toEqual(invalid("containsSlash"));
    expect(h.engine.createFolder([], "..")).toEqual(invalid("dotName"));
    expect(h.engine.createNote([], "x".repeat(151))).toEqual(
      invalid("tooLong", { maxBytes: 150 }),
    );
    expect(h.engine.createNote([], "Projects")).toEqual(invalid("duplicate"));
    expect(h.engine.createFolder([], "Welcome")).toEqual(invalid("duplicate"));
    expect(h.engine.rename(WELCOME, "Journal")).toEqual(invalid("duplicate"));
    expect(h.engine.move(["Projects"], ["Projects"])).toEqual({
      ok: false,
      error: { kind: "invalidTarget" },
    });
    expect(h.engine.move(["Projects"], ["Projects", "commitnote"])).toEqual({
      ok: false,
      error: { kind: "invalidTarget" },
    });
    expect(h.engine.createNote(WELCOME, "Child")).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.delete(["Nope"])).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });

    expect(h.engine.getState().pending).toEqual([]);
    expect(h.engine.getState().save.kind).toBe("idle");
    expect(h.commits).toHaveLength(0);
  });

  it("serializes saves: a structure command during a save goes into the next commit", async () => {
    const h = await setup();
    const release = h.gateCommits();

    h.engine.createNote([], "First");
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    h.engine.createFolder([], "Second");
    await drainAsync();
    expect(h.commits).toHaveLength(1);
    expect(h.engine.getState().pending).toEqual([
      { kind: "create-folder", path: ["Second"] },
      {
        kind: "set-order",
        parent: [],
        positions: [{ name: "Second", key: expect.any(String) }],
      },
    ]);

    release();
    await vi.waitFor(() => expect(h.commits).toHaveLength(2));
    await waitIdle(h.engine);
    const tree = await mainTree(h.fake);
    expect(findNode(tree, ["First"])?.kind).toBe("note");
    expect(findNode(tree, ["Second"])?.kind).toBe("folder");
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("reports pending, syncing and synced states with folder roll-up", async () => {
    const h = await setup();
    const states = () => h.engine.getState().syncStates;

    h.engine.editNote(IDEAS, "ideas");
    expect(states().stateOf(IDEAS)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });
    expect(states().stateOf(["Projects"])).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });
    expect(states().stateOf(WELCOME)).toEqual({ kind: "synced" });

    const release = h.gateCommits();
    h.clock.advance(2_000);
    expect(states().stateOf(IDEAS)).toEqual({ kind: "syncing" });
    expect(states().stateOf(["Projects"])).toEqual({ kind: "syncing" });

    h.engine.editNote(WELCOME, "welcome");
    expect(states().stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });

    release();
    await waitIdle(h.engine);
    expect(states().stateOf(IDEAS)).toEqual({ kind: "synced" });
    expect(states().stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });
    expect(states().unsavedCount).toBe(1);
  });

  it("merges cleanly with another device's edit of a different note", async () => {
    const h = await setup();
    const remoteHead = await pushRemote(h.fake, [
      { kind: "update-note", path: IDEAS, content: "remote ideas" },
    ]);

    h.engine.editNote(WELCOME, "local welcome");
    h.clock.advance(2_000);
    await waitIdle(h.engine);

    const head = await h.fake.getHead();
    expect(h.fake.repo.getCommit(head)?.parent).toBe(remoteHead);
    expect(await mainContent(h.fake, WELCOME)).toBe("local welcome");
    expect(await mainContent(h.fake, IDEAS)).toBe("remote ideas");
    expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
      kind: "synced",
    });
    expect(h.engine.getState().synced?.head).toBe(head);
  });

  it("merges cleanly with a non-overlapping remote edit of the same note", async () => {
    const h = await setup();
    const original = await welcomeText(h.fake);
    const theirs = replaceLine(original, "- Second bullet", "- Second bullet!");
    const mine = replaceLine(original, "# Welcome", "# Welcome home");
    const remoteHead = await pushRemote(h.fake, [
      { kind: "update-note", path: WELCOME, content: theirs },
    ]);

    h.engine.editNote(WELCOME, mine);
    h.clock.advance(2_000);
    await waitIdle(h.engine);

    const head = await h.fake.getHead();
    expect(h.fake.repo.getCommit(head)?.parent).toBe(remoteHead);
    const merged = await welcomeText(h.fake);
    expect(merged).toContain("# Welcome home");
    expect(merged).toContain("- Second bullet!");
    expect(h.engine.getState().syncStates.hasUnsaved).toBe(false);
  });

  it("holds an overlapping edit back as a conflict while the rest commits", async () => {
    const h = await setup();
    const original = await welcomeText(h.fake);
    const theirs = replaceLine(original, "# Welcome", "# Welcome (theirs)");
    const mine = replaceLine(original, "# Welcome", "# Welcome (mine)");
    await pushRemote(h.fake, [
      { kind: "update-note", path: WELCOME, content: theirs },
    ]);

    h.engine.editNote(WELCOME, mine);
    h.engine.editNote(IDEAS, "clean ideas");
    h.clock.advance(2_000);
    await waitIdle(h.engine);

    expect(await mainContent(h.fake, IDEAS)).toBe("clean ideas");
    expect(await welcomeText(h.fake)).toBe(theirs);
    const state = h.engine.getState();
    expect(state.syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "conflict",
    });
    expect(state.syncStates.stateOf(IDEAS)).toEqual({ kind: "synced" });
    expect(state.conflicts).toHaveLength(1);
    const conflict = state.conflicts[0];
    expect(conflict.path).toEqual(WELCOME);
    expect(conflict.mine).toBe(mine);
    expect(conflict.theirs).toBe(theirs);
    expect(conflict.merged).toContain("<<<<<<< mine");
    expect(conflict.merged).toContain(">>>>>>> theirs");
    expect(conflict.editing).toBeNull();
    expect(
      state.notices.filter((notice) => notice.kind === "conflict"),
    ).toEqual([expect.objectContaining({ kind: "conflict", path: WELCOME })]);
  });

  describe("an empty merged change set", () => {
    async function expectNothingCommitted(
      h: Harness,
      remoteHead: string,
    ): Promise<void> {
      await waitIdle(h.engine);
      const state = h.engine.getState();
      expect(await h.fake.getHead()).toBe(remoteHead);
      expect(state.synced?.head).toBe(remoteHead);
      expect(state.save).toEqual({ kind: "idle" });
      expect(state.inFlight).toEqual([]);
      expect(state.pending).toEqual([]);
      expect(state.syncStates.stateOf([])).not.toEqual({ kind: "syncing" });
    }

    it("skips a delete of a note another device edited", async () => {
      const h = await setup();
      const remoteHead = await pushRemote(h.fake, [
        { kind: "update-note", path: WELCOME, content: "remote edit" },
      ]);

      expect(h.engine.delete(WELCOME).ok).toBe(true);
      await expectNothingCommitted(h, remoteHead);

      const state = h.engine.getState();
      expect(state.notices).toEqual([
        expect.objectContaining({
          kind: "merge",
          notice: { kind: "delete-skipped", path: WELCOME, target: "note" },
        }),
      ]);
      expect(state.syncStates.stateOf(WELCOME)).toEqual({ kind: "synced" });
      expect(await welcomeText(h.fake)).toBe("remote edit");
    });

    it("skips a rename onto a name another device created", async () => {
      const h = await setup();
      const remoteHead = await pushRemote(h.fake, [
        { kind: "create-note", path: ["Hello"], content: "remote hello" },
      ]);

      expect(h.engine.rename(WELCOME, "Hello").ok).toBe(true);
      await expectNothingCommitted(h, remoteHead);

      expect(h.engine.getState().notices).toEqual([
        expect.objectContaining({
          kind: "merge",
          notice: expect.objectContaining({
            kind: "rename-skipped",
            reason: "target-exists",
          }),
        }),
      ]);
    });

    it("holds an overlapping edit that was the only change", async () => {
      const h = await setup();
      const { remoteHead } = await heldWelcomeConflict(h);
      await expectNothingCommitted(h, remoteHead);
      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "out-of-sync",
        reason: "conflict",
      });
    });
  });

  describe("resolving a conflict", () => {
    it("keepMine commits mine", async () => {
      const h = await setup();
      const { mine } = await heldWelcomeConflict(h);

      h.engine.resolveConflict(WELCOME, "keepMine");
      await waitIdle(h.engine);

      expect(await welcomeText(h.fake)).toBe(mine);
      expect(h.engine.getState().conflicts).toEqual([]);
      expect(h.engine.getState().syncStates.hasUnsaved).toBe(false);
    });

    it("keepTheirs leaves the remote content and the note synced", async () => {
      const h = await setup();
      const { theirs, remoteHead } = await heldWelcomeConflict(h);

      h.engine.resolveConflict(WELCOME, "keepTheirs");
      await waitIdle(h.engine);

      expect(await h.fake.getHead()).toBe(remoteHead);
      expect(await welcomeText(h.fake)).toBe(theirs);
      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "synced",
      });
    });

    it("editMerged saves only once the markers are gone", async () => {
      const h = await setup();
      const { remoteHead } = await heldWelcomeConflict(h);
      await h.engine.openNote(WELCOME);

      h.engine.resolveConflict(WELCOME, "editMerged");
      const merged = h.engine.getState().conflicts[0].merged;
      expect(h.engine.getState().openNote).toEqual({
        kind: "loaded",
        path: WELCOME,
        blobSha: null,
        content: merged,
      });

      h.engine.editNote(WELCOME, `${merged}\nmore`);
      h.clock.advance(60_000);
      await drainAsync();
      expect(await h.fake.getHead()).toBe(remoteHead);
      expect(h.engine.getState().conflicts[0].editing).toBe(`${merged}\nmore`);
      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "out-of-sync",
        reason: "conflict",
      });

      h.engine.editNote(WELCOME, "# Resolved\n");
      expect(h.engine.getState().conflicts).toEqual([]);
      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "out-of-sync",
        reason: "pending",
      });
      h.clock.advance(1_999);
      expect(h.engine.getState().save.kind).toBe("idle");
      h.clock.advance(1);
      await waitIdle(h.engine);
      expect(await welcomeText(h.fake)).toBe("# Resolved\n");
    });
  });

  describe("a held conflict when the remote changes again", () => {
    it("stays held with the new remote line when the remote edits a different line", async () => {
      const h = await setup();
      const { theirs } = await heldWelcomeConflict(h);
      const remoteHead = await pushRemote(h.fake, [
        {
          kind: "update-note",
          path: WELCOME,
          content: replaceLine(theirs, "- First bullet", "- First!"),
        },
      ]);
      const noticesBefore = h.engine
        .getState()
        .notices.filter((notice) => notice.kind === "conflict").length;

      await h.engine.refresh();
      await waitIdle(h.engine);

      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "out-of-sync",
        reason: "conflict",
      });
      const [conflict] = h.engine.getState().conflicts;
      expect(conflict.merged).toContain("# Welcome (mine)");
      expect(conflict.merged).toContain("# Welcome (theirs)");
      expect(conflict.merged).toContain("- First!");
      expect(
        h.engine
          .getState()
          .notices.filter((notice) => notice.kind === "conflict"),
      ).toHaveLength(noticesBefore + 1);
      expect(await h.fake.getHead()).toBe(remoteHead);
      expect(h.engine.getState().pending).toEqual([]);
    });

    it("resolves cleanly when the remote makes the same change as mine", async () => {
      const h = await setup();
      const { mine } = await heldWelcomeConflict(h);
      await pushRemote(h.fake, [
        {
          kind: "update-note",
          path: WELCOME,
          content: replaceLine(mine, "- First bullet", "- First!"),
        },
      ]);

      await h.engine.refresh();
      await waitIdle(h.engine);

      expect(h.engine.getState().conflicts).toEqual([]);
      const text = await welcomeText(h.fake);
      expect(text).toContain("# Welcome (mine)");
      expect(text).toContain("- First!");
      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "synced",
      });
    });

    it("saves nothing while markers remain in the edited merge and the remote edits elsewhere", async () => {
      const h = await setup();
      const { theirs } = await heldWelcomeConflict(h);
      await h.engine.openNote(WELCOME);
      h.engine.resolveConflict(WELCOME, "editMerged");
      const editing = h.engine.getState().conflicts[0].editing;
      const commitsBefore = h.commits.length;
      const remoteHead = await pushRemote(h.fake, [
        {
          kind: "update-note",
          path: WELCOME,
          content: replaceLine(theirs, "- First bullet", "- First!"),
        },
      ]);

      await h.engine.refresh();
      h.clock.advance(60_000);
      await waitIdle(h.engine);

      expect(await h.fake.getHead()).toBe(remoteHead);
      expect(h.commits).toHaveLength(commitsBefore);
      expect(h.engine.getState().pending).toEqual([]);
      expect(h.engine.getState().conflicts).toHaveLength(1);
      const after = h.engine.getState().conflicts[0].editing;
      expect(after).not.toBe(editing);
      expect(after).toContain("- First!");
      expect(after).toContain(CONFLICT_MARKERS.mine);
      expect(h.engine.getState().syncStates.stateOf(WELCOME)).toEqual({
        kind: "out-of-sync",
        reason: "conflict",
      });
    });

    it("rebases the edited merge onto the new remote version so saving it keeps the remote edit", async () => {
      const h = await setup();
      const { theirs } = await heldWelcomeConflict(h);
      await h.engine.openNote(WELCOME);
      h.engine.resolveConflict(WELCOME, "editMerged");
      const remoteHead = await pushRemote(h.fake, [
        {
          kind: "update-note",
          path: WELCOME,
          content: replaceLine(theirs, "- First bullet", "- First!"),
        },
      ]);
      const noticesBefore = h.engine
        .getState()
        .notices.filter((notice) => notice.kind === "conflict").length;

      await h.engine.refresh();
      await waitIdle(h.engine);

      const editing = h.engine.getState().conflicts[0].editing ?? "";
      expect(editing).toContain("- First!");
      expect(editing).toContain(CONFLICT_MARKERS.mine);
      expect(await h.fake.getHead()).toBe(remoteHead);
      expect(h.engine.getState().pending).toEqual([]);
      expect(
        h.engine
          .getState()
          .notices.filter((notice) => notice.kind === "conflict"),
      ).toHaveLength(noticesBefore + 1);

      h.engine.editNote(WELCOME, withoutTheirsSide(editing));
      await h.engine.flush();

      const text = await welcomeText(h.fake);
      expect(text).toContain("# Welcome (mine)");
      expect(text).toContain("- First!");
    });

    it("keeps a keystroke typed while the new remote version loads", async () => {
      const h = await setup();
      const { theirs } = await heldWelcomeConflict(h);
      await h.engine.openNote(WELCOME);
      h.engine.resolveConflict(WELCOME, "editMerged");
      const remoteHead = await pushRemote(h.fake, [
        {
          kind: "update-note",
          path: WELCOME,
          content: replaceLine(theirs, "- First bullet", "- First!"),
        },
      ]);
      const release = h.gateReads();

      const refreshing = h.engine.refresh();
      await vi.waitFor(() => {
        expect(h.engine.getState().synced?.head).toBe(remoteHead);
      });
      const typed = `${h.engine.getState().conflicts[0].editing}\nmy own line\n${CONFLICT_MARKERS.mine}`;
      h.engine.editNote(WELCOME, typed);
      release();
      await refreshing;
      await waitIdle(h.engine);

      const [conflict] = h.engine.getState().conflicts;
      const tree = await mainTree(h.fake);
      const node = findNode(tree, WELCOME);
      if (node?.kind !== "note") throw new Error("expected Welcome");
      expect(conflict.theirsBlobSha).toBe(node.blobSha);
      expect(conflict.theirs).toContain("- First!");
      expect(conflict.editing).toContain("my own line");
      expect(conflict.editing).toContain("- First!");
    });

    describe.each([
      {
        action: "deletes the note",
        remote: { kind: "delete-note", path: WELCOME } as const,
      },
      {
        action: "renames the note",
        remote: {
          kind: "rename-note",
          from: WELCOME,
          to: ["Welcome renamed"],
        } as const,
      },
      {
        action: "moves the note into a folder",
        remote: {
          kind: "rename-note",
          from: WELCOME,
          to: ["Projects", "Welcome"],
        } as const,
      },
    ])("while Edit merged is active and the remote $action", ({ remote }) => {
      it("saves the edited merge text without marker lines at the original path", async () => {
        const h = await setup();
        const { mine } = await heldWelcomeConflict(h);
        await h.engine.openNote(WELCOME);
        h.engine.resolveConflict(WELCOME, "editMerged");
        const editing = h.engine.getState().conflicts[0].editing ?? "";
        const typed = `${editing}\nmy typed line`;
        h.engine.editNote(WELCOME, typed);
        expect(h.engine.getState().conflicts).toHaveLength(1);
        await pushRemote(h.fake, [remote]);

        await h.engine.refresh();
        await waitIdle(h.engine);
        await h.engine.flush();

        const text = (await welcomeText(h.fake)) ?? "";
        expect(text).toContain("my typed line");
        expect(text).toContain("# Welcome (mine)");
        expect(text).toContain("# Welcome (theirs)");
        expect(hasConflictMarkers(text)).toBe(false);
        expect(text).not.toBe(mine);
        expect(h.engine.getState().conflicts).toEqual([]);
        const notices = h.engine.getState().notices;
        expect(notices).toContainEqual(
          expect.objectContaining({
            kind: "edited-merge-restored",
            path: WELCOME,
          }),
        );
        expect(
          notices.some(
            (notice) =>
              notice.kind === "merge" && notice.notice.kind === "edit-restored",
          ),
        ).toBe(false);
        expect(h.engine.getState().openNote).toMatchObject({
          kind: "loaded",
          content: text,
        });
      });
    });

    it("restores mine when the remote deletes the note", async () => {
      const h = await setup();
      const { mine } = await heldWelcomeConflict(h);
      await pushRemote(h.fake, [{ kind: "delete-note", path: WELCOME }]);

      await h.engine.refresh();
      await waitIdle(h.engine);

      expect(h.engine.getState().conflicts).toEqual([]);
      expect(await welcomeText(h.fake)).toBe(mine);
      expect(h.engine.getState().notices).toContainEqual(
        expect.objectContaining({
          kind: "merge",
          notice: { kind: "edit-restored", path: WELCOME },
        }),
      );
    });
  });

  describe("a held conflict whose folder disappears remotely", () => {
    async function heldIdeasConflict(h: Harness): Promise<string> {
      const original = (await mainContent(h.fake, IDEAS)) ?? "";
      const mine = `${original}\nmine line`;
      await pushRemote(h.fake, [
        {
          kind: "update-note",
          path: IDEAS,
          content: `${original}\ntheirs line`,
        },
      ]);
      h.engine.editNote(IDEAS, mine);
      await h.engine.flush();
      expect(h.engine.getState().conflicts).toHaveLength(1);
      return mine;
    }

    async function expectRestoredAt(h: Harness, mine: string): Promise<void> {
      await h.engine.refresh();
      await waitIdle(h.engine);
      await h.engine.flush();

      expect(h.engine.getState().conflicts).toEqual([]);
      expect(await mainContent(h.fake, IDEAS)).toBe(mine);
      const tree = await mainTree(h.fake);
      expect(findNode(tree, IDEAS.slice(0, 2))?.kind).toBe("folder");
      const kinds = h.engine.getState().notices;
      expect(kinds).toContainEqual(
        expect.objectContaining({
          kind: "merge",
          notice: { kind: "edit-restored", path: IDEAS },
        }),
      );
      expect(kinds.some((notice) => notice.kind === "dropped")).toBe(false);
    }

    it("recreates the note and its folders when the remote deletes an ancestor folder", async () => {
      const h = await setup();
      const mine = await heldIdeasConflict(h);
      await pushRemote(h.fake, [{ kind: "delete-folder", path: ["Projects"] }]);

      await expectRestoredAt(h, mine);
    });

    it("saves the edited merge text at its original path when the remote deletes the folder", async () => {
      const h = await setup();
      await heldIdeasConflict(h);
      await h.engine.openNote(IDEAS);
      h.engine.resolveConflict(IDEAS, "editMerged");
      const editing = h.engine.getState().conflicts[0].editing ?? "";
      h.engine.editNote(IDEAS, `${editing}\nmy typed line`);
      expect(h.engine.getState().conflicts).toHaveLength(1);
      await pushRemote(h.fake, [{ kind: "delete-folder", path: ["Projects"] }]);

      await h.engine.refresh();
      await waitIdle(h.engine);
      await h.engine.flush();

      const text = (await mainContent(h.fake, IDEAS)) ?? "";
      expect(text).toContain("my typed line");
      expect(hasConflictMarkers(text)).toBe(false);
      const tree = await mainTree(h.fake);
      expect(findNode(tree, IDEAS.slice(0, 2))?.kind).toBe("folder");
    });

    it("recreates the note at its original path when the remote renames an ancestor folder", async () => {
      const h = await setup();
      const mine = await heldIdeasConflict(h);
      await pushRemote(h.fake, [
        { kind: "rename-folder", from: ["Projects"], to: ["Work"] },
      ]);

      await expectRestoredAt(h, mine);
    });
  });

  it("restores an edit of a note another device deleted", async () => {
    const h = await setup();
    await pushRemote(h.fake, [{ kind: "delete-note", path: WELCOME }]);

    h.engine.editNote(WELCOME, "kept");
    await h.engine.flush();

    expect(await welcomeText(h.fake)).toBe("kept");
    expect(h.engine.getState().notices).toContainEqual(
      expect.objectContaining({
        kind: "merge",
        notice: { kind: "edit-restored", path: WELCOME },
      }),
    );
  });

  it("keeps typed content on refresh with a pending edit and merges at the save", async () => {
    const h = await setup();
    await h.engine.openNote(WELCOME);
    h.engine.editNote(WELCOME, "typed");
    await pushRemote(h.fake, [
      { kind: "update-note", path: IDEAS, content: "remote ideas" },
    ]);

    await h.engine.refresh();
    expect(h.engine.getState().openNote).toEqual({
      kind: "loaded",
      path: WELCOME,
      blobSha: null,
      content: "typed",
    });
    await waitIdle(h.engine);

    expect(await welcomeText(h.fake)).toBe("typed");
    expect(await mainContent(h.fake, IDEAS)).toBe("remote ideas");
    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      content: "typed",
    });
  });

  it("commits immediately when switching notes with a pending edit", async () => {
    const h = await setup();
    await h.engine.openNote(WELCOME);
    h.engine.editNote(WELCOME, "switched");

    const opening = h.engine.openNote(IDEAS);
    expect(h.engine.getState().save.kind).toBe("saving");
    await opening;
    await waitIdle(h.engine);

    expect(await welcomeText(h.fake)).toBe("switched");
  });

  it("shows local content when opening a note with unsaved changes", async () => {
    const h = await setup();
    h.gateCommits();
    h.engine.createNote([], "Draft");

    await h.engine.openNote(["Draft"]);
    expect(h.engine.getState().openNote).toEqual({
      kind: "loaded",
      path: ["Draft"],
      blobSha: null,
      content: "",
    });
  });

  it("keeps the open note through a folder rename and marks it missing after its delete", async () => {
    const h = await setup();
    await h.engine.openNote(IDEAS);

    h.engine.rename(["Projects"], "Work");
    const moved = ["Work", "commitnote", "Ideas"];
    expect(h.engine.getState().openNote).toMatchObject({
      kind: "loaded",
      path: moved,
    });

    h.engine.delete(moved);
    expect(h.engine.getState().openNote).toEqual({
      kind: "missing",
      path: moved,
    });
    await waitIdle(h.engine);
    const tree = await mainTree(h.fake);
    expect(findNode(tree, moved)).toBeUndefined();
    expect(findNode(tree, ["Work", "commitnote", "Roadmap"])?.kind).toBe(
      "note",
    );
  });

  it("keeps changes after a failed save and commits them once on the retry", async () => {
    const h = await setup();
    const start = await h.fake.getHead();
    h.fake.failNext("commit", new ForgeError("Network"));

    h.engine.editNote(WELCOME, "after failure");
    h.clock.advance(2_000);
    await waitIdle(h.engine);

    let state = h.engine.getState();
    expect(state.save).toEqual({
      kind: "waiting",
      reason: "failed",
      retryAt: h.clock.now() + 5_000,
      error: { kind: "network" },
    });
    expect(state.syncStates.stateOf(WELCOME)).toEqual({
      kind: "out-of-sync",
      reason: "failed",
    });
    expect(state.pending).toHaveLength(1);
    expect(state.inFlight).toEqual([]);

    h.engine.editNote(IDEAS, "second");
    h.clock.advance(5_000);
    await waitIdle(h.engine);

    state = h.engine.getState();
    expect(state.save).toEqual({ kind: "idle" });
    expect(okCommitCount(h.fake, start)).toBe(1);
    expect(await welcomeText(h.fake)).toBe("after failure");
    expect(await mainContent(h.fake, IDEAS)).toBe("second");
  });

  it("never commits twice when loading the tree after a commit fails", async () => {
    const h = await setup();
    const start = await h.fake.getHead();

    h.engine.editNote(WELCOME, "committed once");
    h.fake.failNext("listTree", new ForgeError("Network"));
    await h.engine.flush();
    expect(h.engine.getState().save.kind).toBe("waiting");
    expect(h.commits).toHaveLength(1);

    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(h.commits).toHaveLength(1);
    expect(okCommitCount(h.fake, start)).toBe(1);
    expect(h.engine.getState().synced?.head).toBe(await h.fake.getHead());
    expect(await welcomeText(h.fake)).toBe("committed once");
  });

  it("flush reports saved or the unsaved count", async () => {
    const h = await setup();
    h.engine.editNote(WELCOME, "flushed");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });
    expect(await welcomeText(h.fake)).toBe("flushed");

    h.fake.failNext("commit", new ForgeError("Server"));
    h.engine.editNote(WELCOME, "not flushed");
    expect(await h.engine.flush()).toEqual({ kind: "unsaved", count: 1 });

    const conflicted = await setup();
    await heldWelcomeConflict(conflicted);
    expect(await conflicted.engine.flush()).toEqual({
      kind: "unsaved",
      count: 1,
    });
  });

  it("loads trash from the same listing as the tree", async () => {
    const h = await setup();
    const entryId = "20260930T100000Z-1-aaaaaaaa";
    await pushRemote(h.fake, [{ kind: "trash-note", path: WELCOME, entryId }]);

    await h.engine.refresh();

    const state = h.engine.getState();
    const syncedEntry = state.synced?.trash.find(
      (entry) => entry.id === entryId,
    );
    if (syncedEntry === undefined || syncedEntry.undecryptable) {
      throw new Error("expected a readable synced trash entry");
    }
    expect(syncedEntry.originalPath).toEqual(WELCOME);
    expect(state.trash).toEqual([
      {
        id: entryId,
        deletedAt: Date.UTC(2026, 8, 30, 10, 0, 0),
        undecryptable: false,
        synced: true,
        kind: "note",
        originalPath: WELCOME,
        tree: {
          kind: "note",
          name: "Welcome",
          path: WELCOME,
          syncedPath: null,
          colorTag: null,
          trashBlobSha:
            syncedEntry.tree.kind === "note" ? syncedEntry.tree.blobSha : "",
        },
      },
    ]);
    expect(
      state.workingTree?.root.children.map((child) => child.name),
    ).not.toContain("Welcome");
  });

  it("dismisses notices by id", async () => {
    const h = await setup();
    await heldWelcomeConflict(h);
    const [notice] = h.engine.getState().notices;
    h.engine.dismissNotice(notice.id);
    expect(h.engine.getState().notices).toEqual([]);
  });

  it("works on a freshly initialized notes repo", async () => {
    const fake = new FakeForgeAdapter();
    const created = await createRepoConfig("fresh passphrase", {
      argon2id: sharedMemoizedArgon2id,
    });
    await fake.initialize(created.configText, encodeInitializeMessage());
    const h = await setup(fake, created.keyring);

    expect(h.engine.createFolder([], "Notes")).toEqual({
      ok: true,
      path: ["Notes"],
    });
    expect(h.engine.createNote(["Notes"], "First").ok).toBe(true);
    h.engine.editNote(["Notes", "First"], "# First\n");
    expect(await h.engine.flush()).toEqual({ kind: "saved" });

    const tree = await mainTree(fake, created.keyring);
    expect(findNode(tree, ["Notes"])?.kind).toBe("folder");
    expect(await mainContent(fake, ["Notes", "First"], created.keyring)).toBe(
      "# First\n",
    );
  });
});
