import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChangeSet, NotePath } from "../changes/change";
import { encodeChangeSet } from "../changes/encode-change-set";
import { argon2idDirect } from "../crypto/argon2";
import { deriveKeyring, type Keyring } from "../crypto/keyring";
import { decryptNote } from "../crypto/note-cipher";
import { parseRepoConfig } from "../crypto/repo-config";
import type { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { ForgeError } from "../forge/errors";
import type { CommitRequest, ForgeAdapter } from "../forge/forge-adapter";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../testing/sample-notes-repo/sample-source";
import type { PurgeCaps } from "../trash/expiry";
import { parseTrashEntryId } from "../trash/trash-entry-id";
import { buildTrashIndex } from "../trash/trash-index";
import { buildNoteTree, findNode } from "../tree/note-tree";
import { createRateBudget } from "./rate-budget";
import { createSyncEngine, type SyncEngine } from "./sync-engine";
import { createTestClock } from "./testing/test-clock";
import { SAVE_FIXED_REQUEST_COST, TRASH_PURGE_HEADROOM } from "./tuning";
import { findWorkingNode } from "./working-tree";

let keyring: Keyring;

beforeAll(async () => {
  const probe = await createSampleNotesRepoAdapter();
  const inspection = await probe.inspect();
  if (inspection.kind !== "populated" || inspection.main === null) {
    throw new Error("expected a populated sample notes repo");
  }
  const parsed = parseRepoConfig(inspection.main.repoConfigText ?? "");
  if (parsed.kind !== "valid") {
    throw new Error(`expected a valid repo config, got ${parsed.kind}`);
  }
  keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    argon2idDirect,
  );
});

const START = Date.UTC(2026, 8, 30, 12, 0, 0);
const WELCOME = ["Welcome"];
const ZAZOLC = ["Zażółć gęślą jaźń"];
const PROJECTS = ["Projects"];
const JANUARY = ["Journal", "2026", "January"];

const EXPIRED_WELCOME = "20260801T100000Z-1-aaaaaaaa";
const EXPIRED_ZAZOLC = "20260802T100000Z-1-bbbbbbbb";
const FRESH_PROJECTS = "20260925T100000Z-1-cccccccc";

const TRASHED: ChangeSet = [
  { kind: "trash-note", path: WELCOME, entryId: EXPIRED_WELCOME },
  { kind: "trash-note", path: ZAZOLC, entryId: EXPIRED_ZAZOLC },
  { kind: "trash-folder", path: PROJECTS, entryId: FRESH_PROJECTS },
];

interface Harness {
  readonly fake: FakeForgeAdapter;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly engine: SyncEngine;
  readonly commits: CommitRequest[];
  readonly requestTimes: number[];
  readonly start: string;
  // Makes every following commit wait until the returned release is called.
  gateCommits(): () => void;
}

async function pushRemote(
  fake: FakeForgeAdapter,
  changeSet: ChangeSet,
): Promise<string> {
  const listing = await fake.listTree(await fake.getHead());
  const encoded = await encodeChangeSet({ listing, changeSet, keyring });
  return fake.pushFromAnotherDevice(encoded.changes, encoded.message);
}

async function setup(options?: {
  readonly seed?: ChangeSet;
  readonly usedRequests?: number;
  readonly purgeCaps?: PurgeCaps;
}): Promise<Harness> {
  const clock = createTestClock(START);
  const rateBudget = createRateBudget(clock);
  for (let index = 0; index < (options?.usedRequests ?? 0); index++) {
    rateBudget.record();
  }
  const requestTimes: number[] = [];
  const fake = await createSampleNotesRepoAdapter({
    onContentCreatingRequest: () => {
      requestTimes.push(clock.now());
      rateBudget.record();
    },
  });
  if (options?.seed !== undefined) await pushRemote(fake, options.seed);

  const commits: CommitRequest[] = [];
  const gate: { current: Promise<void> | null } = { current: null };
  const adapter: ForgeAdapter = {
    inspect: () => fake.inspect(),
    initialize: (configText, message) => fake.initialize(configText, message),
    getHead: () => fake.getHead(),
    listTree: (sha) => fake.listTree(sha),
    readBlob: (sha) => fake.readBlob(sha),
    commit: async (request) => {
      commits.push(request);
      if (gate.current !== null) await gate.current;
      return fake.commit(request);
    },
  };
  const engine = createSyncEngine({
    adapter,
    keyring,
    clock,
    rateBudget,
    purgeCaps: options?.purgeCaps,
  });
  await engine.refresh();
  return {
    fake,
    clock,
    engine,
    commits,
    requestTimes,
    start: await fake.getHead(),
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
  };
}

async function settle(engine: SyncEngine): Promise<void> {
  await vi.waitFor(
    () => {
      const state = engine.getState();
      expect(state.save.kind).not.toBe("saving");
      expect(state.refresh.inFlight).toBe(false);
    },
    { timeout: 5_000, interval: 2 },
  );
}

function okCommitCount(fake: FakeForgeAdapter, since: string): number {
  let count = 0;
  let current: string | null | undefined = fake.repo.getRef("main");
  while (current !== since && current != null) {
    count++;
    current = fake.repo.getCommit(current)?.parent;
  }
  return count;
}

async function remoteTrashIds(fake: FakeForgeAdapter): Promise<string[]> {
  const listing = await fake.listTree(await fake.getHead());
  return (await buildTrashIndex(listing, keyring)).map((entry) => entry.id);
}

async function remoteContent(
  fake: FakeForgeAdapter,
  path: NotePath,
): Promise<string | undefined> {
  const tree = await buildNoteTree(
    await fake.listTree(await fake.getHead()),
    keyring,
  );
  const node = findNode(tree, path);
  if (node?.kind !== "note") return undefined;
  return decryptNote(keyring, await fake.readBlob(node.blobSha));
}

function localChanges(engine: SyncEngine): ChangeSet {
  const { inFlight, pending } = engine.getState();
  return [...inFlight, ...pending];
}

function workingTrashIds(engine: SyncEngine): string[] {
  return (engine.getState().trash ?? []).map((entry) => entry.id);
}

describe("sync engine trash commands", () => {
  it("moves a deleted note to the trash under an entry id taken at delete time", async () => {
    const h = await setup();
    const welcome = await remoteContent(h.fake, WELCOME);
    await h.engine.openNote(WELCOME);

    expect(h.engine.delete(WELCOME)).toEqual({ ok: true, path: WELCOME });

    const [change] = localChanges(h.engine);
    if (change?.kind !== "trash-note") throw new Error("expected trash-note");
    expect(parseTrashEntryId(change.entryId)).toEqual({
      deletedAt: START,
      depth: 1,
    });
    expect(h.engine.getState().openNote).toEqual({
      kind: "missing",
      path: WELCOME,
    });
    expect(h.engine.getState().trash).toMatchObject([
      { id: change.entryId, synced: false, kind: "note" },
    ]);

    await settle(h.engine);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await remoteTrashIds(h.fake)).toEqual([change.entryId]);
    expect(await remoteContent(h.fake, WELCOME)).toBeUndefined();
    expect(h.engine.getState().trash).toMatchObject([
      { id: change.entryId, synced: true, originalPath: WELCOME },
    ]);
    const synced = h.engine.getState().synced?.trash[0];
    if (synced?.undecryptable !== false || synced.tree.kind !== "note") {
      throw new Error("expected a readable trashed note");
    }
    expect(
      await decryptNote(keyring, await h.fake.readBlob(synced.tree.blobSha)),
    ).toBe(welcome);
  });

  it("keeps the entry id when the trash commit is merged with a newer remote head", async () => {
    const h = await setup();
    await pushRemote(h.fake, [
      { kind: "update-note", path: ZAZOLC, content: "remote edit" },
    ]);

    h.engine.delete(PROJECTS);
    const [change] = localChanges(h.engine);
    if (change?.kind !== "trash-folder")
      throw new Error("expected trash-folder");
    await settle(h.engine);

    expect(await remoteTrashIds(h.fake)).toEqual([change.entryId]);
    expect(await remoteContent(h.fake, ZAZOLC)).toBe("remote edit");
  });

  it("deletes an empty folder permanently instead of trashing it", async () => {
    const h = await setup();

    h.engine.delete(["Empty folder"]);

    expect(localChanges(h.engine)).toEqual([
      { kind: "delete-folder", path: ["Empty folder"] },
    ]);
    await settle(h.engine);
    expect(await remoteTrashIds(h.fake)).toEqual([]);
    expect(h.engine.getState().trash).toEqual([]);
  });

  it("moves a trashed note into a folder and shows its content before the commit lands", async () => {
    const h = await setup({ seed: TRASHED });
    const original = (await remoteTrashIds(h.fake)).length;
    const release = h.gateCommits();

    const result = h.engine.moveFromTrash(EXPIRED_WELCOME, [], ["Journal"]);

    expect(result).toEqual({ ok: true, path: ["Journal", "Welcome"] });
    expect(workingTrashIds(h.engine)).not.toContain(EXPIRED_WELCOME);
    await h.engine.openNote(["Journal", "Welcome"]);
    const open = h.engine.getState().openNote;
    if (open?.kind !== "loaded") throw new Error("expected a loaded note");
    expect(open.content).toContain("# Welcome");

    release();
    await settle(h.engine);
    expect(await remoteContent(h.fake, ["Journal", "Welcome"])).toBe(
      open.content,
    );
    expect(await remoteTrashIds(h.fake)).toHaveLength(original - 1);
  });

  it("moves one item out of a trashed folder and keeps the rest in the trash", async () => {
    const h = await setup({ seed: TRASHED });

    const result = h.engine.moveFromTrash(
      FRESH_PROJECTS,
      ["commitnote", "Ideas"],
      [],
    );

    expect(result).toEqual({ ok: true, path: ["Ideas"] });
    await settle(h.engine);
    expect(await remoteContent(h.fake, ["Ideas"])).toContain("# Ideas");
    const entry = h.engine
      .getState()
      .trash?.find((item) => item.id === FRESH_PROJECTS);
    if (entry?.undecryptable !== false || entry.tree.kind !== "folder") {
      throw new Error("expected the trashed folder to remain");
    }
    const commitnote = entry.tree.children[0];
    expect(
      commitnote.kind === "folder" &&
        commitnote.children.map((child) => child.name),
    ).toEqual(["Roadmap"]);
  });

  it("rejects moving out of the trash onto a taken name like move does", async () => {
    const h = await setup({ seed: TRASHED });
    h.engine.createNote([], "Welcome");
    h.engine.createNote(["Journal"], "Welcome");
    const pending = h.engine.getState().pending;

    const result = h.engine.moveFromTrash(EXPIRED_WELCOME, [], ["Journal"]);

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalidName", error: { kind: "duplicate" } },
    });
    expect(result).toEqual(h.engine.move(WELCOME, ["Journal"]));
    expect(h.engine.getState().pending).toEqual(pending);
    expect(workingTrashIds(h.engine)).toContain(EXPIRED_WELCOME);
  });

  it("reports unknown trash entries, items and targets as not found", async () => {
    const h = await setup({ seed: TRASHED });

    expect(h.engine.moveFromTrash("nope", [], [])).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.moveFromTrash(FRESH_PROJECTS, ["missing"], [])).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.moveFromTrash(EXPIRED_WELCOME, [], ["missing"])).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("deletes chosen trash entries forever in one commit", async () => {
    const h = await setup({ seed: TRASHED });

    h.engine.deleteFromTrash([EXPIRED_ZAZOLC, "unknown"]);

    expect(localChanges(h.engine)).toEqual([
      { kind: "purge-trash", entryIds: [EXPIRED_ZAZOLC] },
    ]);
    expect(h.engine.getState().syncStates.hasUnsaved).toBe(false);
    await settle(h.engine);
    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await remoteTrashIds(h.fake)).toEqual([
      EXPIRED_WELCOME,
      FRESH_PROJECTS,
    ]);
  });

  it("empties the whole trash in one commit", async () => {
    const h = await setup({ seed: TRASHED });

    h.engine.emptyTrash();
    await settle(h.engine);

    expect(okCommitCount(h.fake, h.start)).toBe(1);
    expect(await remoteTrashIds(h.fake)).toEqual([]);
    expect(h.engine.getState().trash).toEqual([]);
  });
});

describe("sync engine startup trash purge", () => {
  it("purges expired entries in exactly one commit", async () => {
    const h = await setup({ seed: TRASHED });
    const requestsBefore = h.requestTimes.length;

    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(h.requestTimes.length - requestsBefore).toBe(
      SAVE_FIXED_REQUEST_COST,
    );
    expect(await remoteTrashIds(h.fake)).toEqual([FRESH_PROJECTS]);
    expect(h.engine.getState().save).toEqual({ kind: "idle" });
  });

  it("never counts the purge as unsaved work", async () => {
    const h = await setup({ seed: TRASHED });
    const release = h.gateCommits();

    h.engine.purgeExpiredTrash();

    await vi.waitFor(() => expect(h.commits).toHaveLength(1));
    expect(h.engine.getState().inFlight).toHaveLength(1);
    expect(h.engine.getState().syncStates.unsavedCount).toBe(0);
    expect(h.engine.getState().syncStates.hasUnsaved).toBe(false);
    release();
    await settle(h.engine);
  });

  it("skips the purge when the rate budget lacks headroom, and runs only once", async () => {
    const h = await setup({
      seed: TRASHED,
      usedRequests: 60 - SAVE_FIXED_REQUEST_COST - TRASH_PURGE_HEADROOM + 1,
    });

    h.engine.purgeExpiredTrash();
    h.clock.advance(3_600_000);
    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    expect(h.commits).toHaveLength(0);
    expect(h.engine.getState().pending).toEqual([]);
  });

  it("skips the purge when the last refresh failed", async () => {
    const h = await setup({ seed: TRASHED });
    h.fake.failNext("getHead", new ForgeError("Network"));
    await h.engine.refresh();
    expect(h.engine.getState().refresh.lastError).toEqual({ kind: "network" });

    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    expect(h.commits).toHaveLength(0);
  });

  it("purges only the first batch per startup", async () => {
    const h = await setup({
      seed: TRASHED,
      purgeCaps: { maxEntries: 100, maxFilesPerCommit: 1 },
    });

    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(await remoteTrashIds(h.fake)).toEqual([
      EXPIRED_ZAZOLC,
      FRESH_PROJECTS,
    ]);
  });

  it("drops a failed purge without a failed status or retries", async () => {
    const h = await setup({ seed: TRASHED });
    h.fake.failNext("commit", new ForgeError("Network"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    h.engine.purgeExpiredTrash();
    await settle(h.engine);
    h.clock.advance(600_000);
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    const state = h.engine.getState();
    expect(state.save).toEqual({ kind: "idle" });
    expect(state.pending).toEqual([]);
    expect(state.inFlight).toEqual([]);
    expect(workingTrashIds(h.engine)).toContain(EXPIRED_WELCOME);
    expect(error).toHaveBeenCalledWith("Trash purge failed", "network");
    error.mockRestore();
  });

  it("merges the purge with a newer remote head", async () => {
    const h = await setup({ seed: TRASHED });
    await pushRemote(h.fake, [
      { kind: "update-note", path: JANUARY, content: "remote edit" },
    ]);

    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    expect(h.commits).toHaveLength(2);
    expect(okCommitCount(h.fake, h.start)).toBe(2);
    expect(await remoteContent(h.fake, JANUARY)).toBe("remote edit");
    expect(await remoteTrashIds(h.fake)).toEqual([FRESH_PROJECTS]);
  });

  it("rides in the same commit as a pending edit", async () => {
    const h = await setup({ seed: TRASHED });
    h.engine.editNote(JANUARY, "local edit");

    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    expect(h.commits).toHaveLength(1);
    expect(await remoteContent(h.fake, JANUARY)).toBe("local edit");
    expect(await remoteTrashIds(h.fake)).toEqual([FRESH_PROJECTS]);
  });

  it("retries a failed purge mixed with an edit like any other save", async () => {
    const h = await setup({ seed: TRASHED });
    h.fake.failNext("commit", new ForgeError("Network"));
    h.engine.editNote(JANUARY, "local edit");

    h.engine.purgeExpiredTrash();
    await settle(h.engine);

    const state = h.engine.getState();
    expect(state.save).toMatchObject({ kind: "waiting", reason: "failed" });
    expect(state.pending.map((change) => change.kind)).toEqual([
      "update-note",
      "purge-trash",
    ]);
    h.engine.retryNow();
    await settle(h.engine);
    expect(await remoteTrashIds(h.fake)).toEqual([FRESH_PROJECTS]);
    expect(await remoteContent(h.fake, JANUARY)).toBe("local edit");
  });

  it("does not purge entries a pending change already took out of the trash", async () => {
    const h = await setup({ seed: TRASHED });
    const release = h.gateCommits();
    h.engine.moveFromTrash(EXPIRED_WELCOME, [], []);
    await vi.waitFor(() => expect(h.commits).toHaveLength(1));

    h.engine.purgeExpiredTrash();
    release();
    await settle(h.engine);

    expect(h.commits).toHaveLength(2);
    expect(await remoteTrashIds(h.fake)).toEqual([FRESH_PROJECTS]);
    expect(await remoteContent(h.fake, WELCOME)).toContain("# Welcome");
    expect(
      findWorkingNode(h.engine.getState().workingTree!, WELCOME)?.kind,
    ).toBe("note");
  });
});
