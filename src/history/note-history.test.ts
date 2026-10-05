import { describe, expect, it } from "vitest";
import type { Change, NotePath } from "../changes/change";
import {
  encodeChangeSet,
  encodeInitializeMessage,
} from "../changes/encode-change-set";
import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { ForgeError } from "../forge/errors";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { commitFiles, InMemoryGitRepo } from "../forge/fake/in-memory-git-repo";
import type { ForgeAdapter } from "../forge/forge-adapter";
import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../format/v1";
import type { OrderIndex } from "../order/order-index";
import {
  commitPassphraseChange,
  preparePassphraseChange,
} from "../rekey/change-passphrase";
import { fastArgon2id } from "../crypto/testing/test-keyring";
import {
  createRekeyFixture,
  NEW_PASSPHRASE,
  newRepoConfig,
  OLD_PASSPHRASE,
} from "../rekey/testing/rekey-fixture";
import { createRateBudget } from "../sync/rate-budget";
import { createSyncEngine } from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import {
  createNoteHistory,
  HISTORY_MAX_REQUESTS,
  type NoteHistory,
  type NoteHistoryCursor,
  type NoteVersion,
} from "./note-history";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 8, 12, 12);
const TRASH_ID = "20260912T120000Z-1-aaaaaaaa";
const TRASH_ID_DEPTH_2 = "20260912T120000Z-2-aaaaaaaa";
const NO_ORDER: OrderIndex = { writable: false, folders: new Map() };

interface Repo {
  readonly adapter: FakeForgeAdapter;
  keyring: Keyring;
  save(...changeSet: Change[]): Promise<string>;
}

function saver(
  adapter: FakeForgeAdapter,
  repo: Pick<Repo, "keyring">,
): Repo["save"] {
  return async (...changeSet) => {
    const parent = await adapter.getHead();
    const { changes, message } = await encodeChangeSet({
      listing: await adapter.listTree(parent),
      changeSet,
      order: NO_ORDER,
      keyring: repo.keyring,
    });
    const result = await adapter.commit({ parent, changes, message });
    if (result.kind !== "ok") throw new Error("stale");
    return result.head;
  };
}

async function createRepo(): Promise<Repo> {
  let time = T0;
  const git = new InMemoryGitRepo({ now: () => (time += MINUTE) });
  const { configText, keyring } = await newRepoConfig(OLD_PASSPHRASE);
  await commitFiles(git, {
    parent: null,
    files: { [REPO_CONFIG_PATH]: configText },
    message: encodeInitializeMessage(),
    branch: MAIN_BRANCH,
  });
  const adapter = new FakeForgeAdapter({ repo: git });
  const repo: Repo = { adapter, keyring, save: async () => "" };
  repo.save = saver(adapter, repo);
  return repo;
}

function counting(adapter: FakeForgeAdapter) {
  const calls = { listCommits: 0, readFileAt: 0, listTree: 0 };
  const counted: Pick<ForgeAdapter, "listCommits" | "readFileAt" | "listTree"> =
    {
      listCommits: (request) => {
        calls.listCommits++;
        return adapter.listCommits(request);
      },
      readFileAt: (sha, path) => {
        calls.readFileAt++;
        return adapter.readFileAt(sha, path);
      },
      listTree: (sha) => {
        calls.listTree++;
        return adapter.listTree(sha);
      },
    };
  return { calls, counted };
}

async function openFully(
  history: NoteHistory,
  repo: Repo,
  path: NotePath,
): Promise<NoteHistoryCursor> {
  const cursor = history.open(path, await repo.adapter.getHead());
  for (let i = 0; i < 20 && cursor.getState().end === null; i++) {
    await cursor.loadMore();
    if (cursor.getState().error !== null) break;
  }
  return cursor;
}

async function contents(
  history: NoteHistory,
  versions: readonly NoteVersion[],
): Promise<string[]> {
  const result: string[] = [];
  for (const version of versions) {
    const content = await history.readVersion(version);
    result.push(content.kind === "readable" ? content.content : content.kind);
  }
  return result;
}

function rows(versions: readonly NoteVersion[]) {
  return versions.map((v) => [v.name, v.events]);
}

const create = (path: string[], content: string): Change => ({
  kind: "create-note",
  path,
  content,
});
const update = (path: string[], content: string): Change => ({
  kind: "update-note",
  path,
  content,
});

describe("note history", () => {
  it("lists every edit newest first, down to the note's creation", async () => {
    const repo = await createRepo();
    await repo.save(create(["Note"], "v1"));
    await repo.save(update(["Note"], "v2"));
    await repo.save(update(["Note"], "v3"));
    const history = createNoteHistory(repo);

    const cursor = await openFully(history, repo, ["Note"]);

    const { versions, end, loading, error } = cursor.getState();
    expect(rows(versions)).toEqual([
      ["Note", []],
      ["Note", []],
      ["Note", ["created"]],
    ]);
    expect({ end, loading, error }).toEqual({
      end: { kind: "created" },
      loading: false,
      error: null,
    });
    expect(versions.map((v) => v.committedAt)).toEqual([
      T0 + 4 * MINUTE,
      T0 + 3 * MINUTE,
      T0 + 2 * MINUTE,
    ]);
    expect(await contents(history, versions)).toEqual(["v3", "v2", "v1"]);
  });

  it("follows the note through a rename, a move and a rename of its folder", async () => {
    const repo = await createRepo();
    await repo.save(
      { kind: "create-folder", path: ["F"] },
      create(["A"], "a1"),
    );
    await repo.save(update(["A"], "a2"));
    await repo.save({ kind: "rename-note", from: ["A"], to: ["B"] });
    await repo.save({ kind: "rename-note", from: ["B"], to: ["F", "B"] });
    await repo.save({ kind: "rename-folder", from: ["F"], to: ["G"] });
    await repo.save(update(["G", "B"], "b"));
    const history = createNoteHistory(repo);

    const { versions, end } = (
      await openFully(history, repo, ["G", "B"])
    ).getState();

    expect(rows(versions)).toEqual([
      ["B", []],
      ["B", ["moved"]],
      ["B", ["moved"]],
      ["B", ["renamed"]],
      ["A", []],
      ["A", ["created"]],
    ]);
    expect(end).toEqual({ kind: "created" });
    expect(await contents(history, versions)).toEqual([
      "b",
      "a2",
      "a2",
      "a2",
      "a2",
      "a1",
    ]);
  });

  it("follows a note restored on its own out of a trashed folder", async () => {
    const repo = await createRepo();
    await repo.save(
      { kind: "create-folder", path: ["F"] },
      create(["F", "N"], "a"),
      create(["F", "Other"], "a"),
    );
    await repo.save(update(["F", "N"], "b"));
    await repo.save({ kind: "trash-folder", path: ["F"], entryId: TRASH_ID });
    await repo.save({
      kind: "restore-trash",
      entryId: TRASH_ID,
      subPath: ["N"],
      target: "note",
      to: ["N"],
    });
    await repo.save(update(["N"], "c"));
    const history = createNoteHistory(repo);

    const { versions, end } = (
      await openFully(history, repo, ["N"])
    ).getState();

    expect(rows(versions)).toEqual([
      ["N", []],
      ["N", ["restoredFromTrash"]],
      ["N", []],
      ["N", ["created"]],
    ]);
    expect(end).toEqual({ kind: "created" });
    expect(await contents(history, versions)).toEqual(["c", "b", "b", "a"]);
  });

  it.each<[string, Change, NotePath]>([
    [
      "note",
      { kind: "trash-note", path: ["F", "N"], entryId: TRASH_ID_DEPTH_2 },
      [],
    ],
    ["folder", { kind: "trash-folder", path: ["F"], entryId: TRASH_ID }, ["N"]],
  ])(
    "follows a note restored from a trashed %s and edited in the same commit",
    async (_, trash, subPath) => {
      const repo = await createRepo();
      await repo.save(
        { kind: "create-folder", path: ["F"] },
        create(["F", "N"], "a"),
        create(["F", "Other"], "a"),
      );
      await repo.save(trash);
      await repo.save(
        {
          kind: "restore-trash",
          entryId: (trash as { entryId: string }).entryId,
          subPath,
          target: "note",
          to: ["N"],
        },
        update(["N"], "b"),
      );
      const history = createNoteHistory(repo);

      const { versions, end } = (
        await openFully(history, repo, ["N"])
      ).getState();

      expect(rows(versions)).toEqual([
        ["N", ["restoredFromTrash"]],
        ["N", ["created"]],
      ]);
      expect(end).toEqual({ kind: "created" });
      expect(await contents(history, versions)).toEqual(["b", "a"]);
    },
  );

  it("follows a note whose whole folder was trashed and restored", async () => {
    const repo = await createRepo();
    await repo.save(
      { kind: "create-folder", path: ["F"] },
      create(["F", "N"], "a"),
    );
    await repo.save({ kind: "trash-folder", path: ["F"], entryId: TRASH_ID });
    await repo.save({
      kind: "restore-trash",
      entryId: TRASH_ID,
      subPath: [],
      target: "folder",
      to: ["F"],
    });
    const history = createNoteHistory(repo);

    const { versions, end } = (
      await openFully(history, repo, ["F", "N"])
    ).getState();

    expect(rows(versions)).toEqual([
      ["N", ["restoredFromTrash"]],
      ["N", ["created"]],
    ]);
    expect(end).toEqual({ kind: "created" });
  });

  it("stops at a recreation under the same name", async () => {
    const repo = await createRepo();
    await repo.save(create(["N"], "old"));
    await repo.save({ kind: "delete-note", path: ["N"] });
    await repo.save(create(["N"], "new"));
    await repo.save(update(["N"], "newer"));
    const history = createNoteHistory(repo);

    const { versions, end } = (
      await openFully(history, repo, ["N"])
    ).getState();

    expect(await contents(history, versions)).toEqual(["newer", "new"]);
    expect(end).toEqual({ kind: "created" });
  });

  it("labels a commit from outside commitnote and reports content it can't decrypt", async () => {
    const repo = await createRepo();
    await repo.save(create(["N"], "a"));
    await repo.adapter.pushFromAnotherDevice(
      [
        {
          kind: "upsert-text",
          path: await encryptPath(repo.keyring, ["N"]),
          text: "v1:not-a-ciphertext",
        },
      ],
      "Edit by hand",
    );
    const history = createNoteHistory(repo);

    const { versions } = (await openFully(history, repo, ["N"])).getState();

    expect(rows(versions)).toEqual([
      ["N", ["external"]],
      ["N", ["created"]],
    ]);
    expect(await history.readVersion(versions[0])).toEqual({
      kind: "undecryptable",
      name: "N",
    });
  });

  describe("at a passphrase change", () => {
    it.each([
      [false, false],
      [true, true],
    ])(
      "ends with the change's commit (history removed: %s)",
      async (removeHistory, historyDeleted) => {
        const fixture = await createRekeyFixture();
        const old = { keyring: fixture.oldKeyring };
        await saver(fixture.adapter, old)(update(["Welcome"], "before"));
        const clock = createTestClock(T0);
        const engine = createSyncEngine({
          adapter: fixture.adapter,
          keyring: fixture.oldKeyring,
          clock,
        });
        await engine.refresh();
        const deps = {
          adapter: fixture.adapter,
          engine,
          rateBudget: createRateBudget(clock, fixture.adapter.limits),
          clock,
          argon2id: fastArgon2id,
          sleep: async () => {},
        };
        const prepared = await preparePassphraseChange(deps, {
          currentPassphrase: OLD_PASSPHRASE,
          newPassphrase: NEW_PASSPHRASE,
          removeHistory,
        });
        if (!prepared.ok) throw new Error(prepared.failure.kind);
        const changed = await commitPassphraseChange(deps, prepared.prepared);
        if (!changed.ok) throw new Error(changed.failure.kind);
        engine.dispose();
        const current = { keyring: changed.keyring };
        await saver(fixture.adapter, current)(update(["Welcome"], "after"));
        const history = createNoteHistory({
          adapter: fixture.adapter,
          keyring: changed.keyring,
        });

        const { versions, end } = (
          await openFully(
            history,
            { adapter: fixture.adapter, ...current, save: async () => "" },
            ["Welcome"],
          )
        ).getState();

        expect(rows(versions)).toEqual([
          ["Welcome", []],
          ["Welcome", ["passphraseChanged"]],
        ]);
        expect(end).toEqual({ kind: "passphraseChanged", historyDeleted });
        expect(await contents(history, versions)).toEqual(["after", "before"]);
      },
    );
  });

  describe("loading", () => {
    it("pages through a long history across a rename", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "0"));
      for (let i = 1; i <= 60; i++) await repo.save(update(["N"], `${i}`));
      await repo.save({ kind: "rename-note", from: ["N"], to: ["M"] });
      for (let i = 61; i <= 70; i++) await repo.save(update(["M"], `${i}`));
      const history = createNoteHistory(repo);
      const cursor = history.open(["M"], await repo.adapter.getHead());

      await cursor.loadMore();
      const first = cursor.getState();
      await cursor.loadMore();
      const second = cursor.getState();

      expect(first.end).toBeNull();
      expect(first.versions).toHaveLength(61);
      expect(second.end).toEqual({ kind: "created" });
      expect(second.versions).toHaveLength(72);
      expect(new Set(second.versions.map((v) => v.sha)).size).toBe(72);
      expect(await contents(history, second.versions.slice(-1))).toEqual(["0"]);
    });

    it("sends a bounded number of requests per load along a chain of renames", async () => {
      const repo = await createRepo();
      await repo.save(create(["N0"], "x"));
      for (let i = 1; i <= 8; i++) {
        await repo.save({
          kind: "rename-note",
          from: [`N${i - 1}`],
          to: [`N${i}`],
        });
      }
      const { calls, counted } = counting(repo.adapter);
      const history = createNoteHistory({
        adapter: counted,
        keyring: repo.keyring,
      });
      const cursor = history.open(["N8"], await repo.adapter.getHead());

      await cursor.loadMore();

      expect(calls.listCommits).toBe(HISTORY_MAX_REQUESTS);
      expect(cursor.getState()).toMatchObject({ end: null, loading: false });
      await cursor.loadMore();
      expect(cursor.getState().versions.map((v) => v.name)).toEqual(
        Array.from({ length: 9 }, (_, i) => `N${8 - i}`),
      );
    });

    it("reports a failed load and loads again on retry", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      repo.adapter.failNext("listCommits", new ForgeError("Network"));
      const history = createNoteHistory(repo);
      const cursor = history.open(["N"], await repo.adapter.getHead());

      await cursor.loadMore();
      const failed = cursor.getState();
      await cursor.retry();

      expect(failed).toMatchObject({
        versions: [],
        end: null,
        loading: false,
        error: { kind: "network" },
      });
      expect(cursor.getState()).toMatchObject({
        end: { kind: "created" },
        error: null,
      });
      expect(cursor.getState().versions).toHaveLength(1);
    });

    it("lists each version once after a failure while tracing a restore", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      await repo.save({ kind: "trash-note", path: ["N"], entryId: TRASH_ID });
      await repo.save({
        kind: "restore-trash",
        entryId: TRASH_ID,
        subPath: [],
        target: "note",
        to: ["N"],
      });
      await repo.save(update(["N"], "b"));
      repo.adapter.failNext("listTree", new ForgeError("Server"));
      const history = createNoteHistory(repo);
      const cursor = history.open(["N"], await repo.adapter.getHead());

      await cursor.loadMore();
      const failed = cursor.getState();
      await cursor.retry();

      expect(failed.error).toEqual({ kind: "server" });
      expect(rows(failed.versions)).toEqual([["N", []]]);
      expect(rows(cursor.getState().versions)).toEqual([
        ["N", []],
        ["N", ["restoredFromTrash"]],
        ["N", ["created"]],
      ]);
    });

    it("tells subscribers about loading and the loaded versions", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const history = createNoteHistory(repo);
      const cursor = history.open(["N"], await repo.adapter.getHead());
      const seen: [boolean, number][] = [];

      const unsubscribe = cursor.subscribe((state) =>
        seen.push([state.loading, state.versions.length]),
      );
      await cursor.loadMore();
      unsubscribe();

      expect(seen[0]).toEqual([true, 0]);
      expect(seen.at(-1)).toEqual([false, 1]);
    });
  });

  describe("caching", () => {
    it("returns the loaded cursor again for the same note and head", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const head = await repo.adapter.getHead();
      const { calls, counted } = counting(repo.adapter);
      const history = createNoteHistory({
        adapter: counted,
        keyring: repo.keyring,
      });
      const first = history.open(["N"], head);
      await first.loadMore();

      const again = history.open(["N"], head);

      expect(again).toBe(first);
      expect(again.getState().versions).toHaveLength(1);
      expect(calls.listCommits).toBe(1);
    });

    it("loads afresh for a newer head", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const history = createNoteHistory(repo);
      const old = history.open(["N"], await repo.adapter.getHead());
      await old.loadMore();
      await repo.save(update(["N"], "b"));

      const fresh = history.open(["N"], await repo.adapter.getHead());
      await fresh.loadMore();

      expect(fresh).not.toBe(old);
      expect(fresh.getState().versions).toHaveLength(2);
    });

    it("reads a version again without the forge", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const history = createNoteHistory(repo);
      const { versions } = (await openFully(history, repo, ["N"])).getState();
      await history.readVersion(versions[0]);
      repo.adapter.failNext("readFileAt", new ForgeError("Network"));

      expect(await history.readVersion(versions[0])).toEqual({
        kind: "readable",
        content: "a",
        name: "N",
      });
    });

    it("reports a version it could not read", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const history = createNoteHistory(repo);
      const { versions } = (await openFully(history, repo, ["N"])).getState();
      repo.adapter.failNext("readFileAt", new ForgeError("RateLimited"));

      expect(await history.readVersion(versions[0])).toMatchObject({
        kind: "failed",
        error: { kind: "rateLimited" },
      });
    });
  });
});
