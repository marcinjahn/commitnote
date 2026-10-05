import { describe, expect, it, vi } from "vitest";
import type { Change, NotePath } from "../changes/change";
import {
  encodeChangeSet,
  encodeInitializeMessage,
} from "../changes/encode-change-set";
import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { encryptNote } from "../crypto/note-cipher";
import { ForgeError } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import { commitFiles, InMemoryGitRepo } from "../forge/fake/in-memory-git-repo";
import type { ListCommitsRequest } from "../forge/forge-adapter";
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
  createNoteDates,
  NOTE_DATES_CACHE_SIZE,
  NOTE_DATES_MAX_LIST_REQUESTS,
  NOTE_DATES_PAGE_SIZE,
  type NoteDatesResolver,
} from "./note-dates";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 8, 12, 12);
const TRASH_ID = "20260912T120000Z-1-aaaaaaaa";
const NO_ORDER: OrderIndex = { writable: false, folders: new Map() };

interface Repo {
  readonly adapter: FakeForgeAdapter;
  readonly keyring: Keyring;
  save(...changeSet: Change[]): Promise<string>;
  timeOf(sha: string): number;
  blobOf(notePath: NotePath): Promise<string>;
}

function repoOver(adapter: FakeForgeAdapter, keyring: Keyring): Repo {
  return {
    adapter,
    keyring,
    async save(...changeSet) {
      const parent = await adapter.getHead();
      const { changes, message } = await encodeChangeSet({
        listing: await adapter.listTree(parent),
        changeSet,
        order: NO_ORDER,
        keyring,
      });
      const result = await adapter.commit({ parent, changes, message });
      if (result.kind !== "ok") throw new Error("stale");
      return result.head;
    },
    timeOf(sha) {
      return adapter.repo.getCommit(sha)!.committedAt;
    },
    async blobOf(notePath) {
      const file = await adapter.readFileAt(
        await adapter.getHead(),
        await encryptPath(keyring, notePath),
      );
      return file!.blobSha;
    },
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
  return repoOver(new FakeForgeAdapter({ repo: git }), keyring);
}

function counting(adapter: FakeForgeAdapter) {
  const calls = {
    listCommits: [] as ListCommitsRequest[],
    findOldestCommit: 0,
    readFileAt: 0,
    listTree: 0,
  };
  const counted = delegateAdapter(adapter, {
    listCommits: (request) => {
      calls.listCommits.push(request);
      return adapter.listCommits(request);
    },
    findOldestCommit: (request) => {
      calls.findOldestCommit++;
      return adapter.findOldestCommit(request);
    },
    readFileAt: (sha, path) => {
      calls.readFileAt++;
      return adapter.readFileAt(sha, path);
    },
    listTree: (sha) => {
      calls.listTree++;
      return adapter.listTree(sha);
    },
  });
  const requests = () =>
    calls.listCommits.length +
    calls.findOldestCommit +
    calls.readFileAt +
    calls.listTree;
  return { calls, counted, requests };
}

function setup(repo: Repo) {
  const clock = createTestClock(T0);
  const counter = counting(repo.adapter);
  const dates = createNoteDates({
    adapter: counter.counted,
    keyring: repo.keyring,
    clock,
  });
  return { ...counter, clock, dates };
}

async function resolve(
  dates: NoteDatesResolver,
  repo: Repo,
  notePath: NotePath,
) {
  return dates.resolve(
    notePath,
    await repo.adapter.getHead(),
    await repo.blobOf(notePath),
  );
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

describe("note dates", () => {
  describe("full resolution", () => {
    it("dates a note from its creation to its last edit with one request", async () => {
      const repo = await createRepo();
      const created = await repo.save(create(["N"], "a"));
      await repo.save(update(["N"], "b"));
      const edited = await repo.save(update(["N"], "c"));
      const { dates, calls } = setup(repo);

      const result = await resolve(dates, repo, ["N"]);

      expect(result).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(edited),
      });
      expect(calls.listCommits).toHaveLength(1);
      expect(calls.findOldestCommit).toBe(0);
    });

    it("follows a rename back to the original creation", async () => {
      const repo = await createRepo();
      const created = await repo.save(create(["A"], "a"));
      const renamed = await repo.save({
        kind: "rename-note",
        from: ["A"],
        to: ["B"],
      });
      const { dates } = setup(repo);

      expect(await resolve(dates, repo, ["B"])).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(renamed),
      });
    });

    it("follows a move into a folder back to the original creation", async () => {
      const repo = await createRepo();
      const created = await repo.save(
        { kind: "create-folder", path: ["F"] },
        create(["N"], "a"),
      );
      await repo.save({ kind: "rename-note", from: ["N"], to: ["F", "N"] });
      const edited = await repo.save(update(["F", "N"], "b"));
      const { dates } = setup(repo);

      expect(await resolve(dates, repo, ["F", "N"])).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(edited),
      });
    });

    it("follows a note restored from the trash back to the original creation", async () => {
      const repo = await createRepo();
      const created = await repo.save(create(["N"], "a"));
      await repo.save(update(["N"], "b"));
      await repo.save({ kind: "trash-note", path: ["N"], entryId: TRASH_ID });
      await repo.save({
        kind: "restore-trash",
        entryId: TRASH_ID,
        subPath: [],
        target: "note",
        to: ["N"],
      });
      const edited = await repo.save(update(["N"], "c"));
      const { dates } = setup(repo);

      expect(await resolve(dates, repo, ["N"])).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(edited),
      });
    });

    it("dates a note re-created under a trashed note's name from the re-creation", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "old"));
      await repo.save({ kind: "trash-note", path: ["N"], entryId: TRASH_ID });
      const recreated = await repo.save(create(["N"], "new"));
      const edited = await repo.save(update(["N"], "newer"));
      const { dates } = setup(repo);

      expect(await resolve(dates, repo, ["N"])).toEqual({
        created: { at: repo.timeOf(recreated), exact: true },
        updated: repo.timeOf(edited),
      });
    });

    it("resolves a forgotten note from scratch instead of refreshing the earlier dates", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "old"));
      const { dates, calls } = setup(repo);
      await resolve(dates, repo, ["N"]);
      await repo.save({ kind: "trash-note", path: ["N"], entryId: TRASH_ID });
      const recreated = await repo.save(create(["N"], "new"));
      await repo.save(update(["N"], "newer"));
      const edited = await repo.save(update(["N"], "newest"));
      calls.listCommits.length = 0;

      dates.forget(["N"]);
      const result = await resolve(dates, repo, ["N"]);

      expect(result).toEqual({
        created: { at: repo.timeOf(recreated), exact: true },
        updated: repo.timeOf(edited),
      });
      expect(calls.listCommits).toHaveLength(1);
      expect(calls.listCommits[0]!.limit).toBe(NOTE_DATES_PAGE_SIZE);
    });

    describe("overlapping resolutions", () => {
      async function heldSetup() {
        const repo = await createRepo();
        const created = await repo.save(create(["N"], "a"));
        const head1 = await repo.adapter.getHead();
        const blob1 = await repo.blobOf(["N"]);
        const edited = await repo.save(update(["N"], "b"));
        const head2 = await repo.adapter.getHead();
        const blob2 = await repo.blobOf(["N"]);
        const held: { request: ListCommitsRequest; release: () => void }[] = [];
        const dates = createNoteDates({
          adapter: delegateAdapter(repo.adapter, {
            listCommits: async (request) => {
              await new Promise<void>((release) => held.push({ request, release }));
              return repo.adapter.listCommits(request);
            },
          }),
          keyring: repo.keyring,
          clock: createTestClock(T0),
        });
        const waitForHeld = (count: number) =>
          vi.waitFor(() => expect(held).toHaveLength(count));
        const release = (from: string) => {
          const entry = held.find((h) => h.request.from === from);
          if (!entry) throw new Error(`no held listCommits from ${from}`);
          entry.release();
        };
        return {
          repo,
          dates,
          waitForHeld,
          release,
          created,
          edited,
          head1,
          blob1,
          head2,
          blob2,
        };
      }

      it("keeps the newer blob's dates when an older resolution finishes last", async () => {
        const s = await heldSetup();
        const older = s.dates.resolve(["N"], s.head1, s.blob1);
        const newer = s.dates.resolve(["N"], s.head2, s.blob2);
        await s.waitForHeld(2);

        s.release(s.head2);
        const newerDates = await newer;
        s.release(s.head1);

        const expected = {
          created: { at: s.repo.timeOf(s.created), exact: true },
          updated: s.repo.timeOf(s.edited),
        };
        expect(newerDates).toEqual(expected);
        expect(await older).toEqual(expected);
        expect(s.dates.cached(["N"])?.blobSha).toBe(s.blob2);
      });

      it("does not let a resolution started before forgetting repopulate the cache", async () => {
        const s = await heldSetup();
        const pending = s.dates.resolve(["N"], s.head2, s.blob2);
        await s.waitForHeld(1);

        s.dates.forget(["N"]);
        s.release(s.head2);
        await pending;

        expect(s.dates.cached(["N"])).toBeNull();
      });
    });

    it("dates a note first committed in a parentless commit from outside commitnote at that commit", async () => {
      let time = T0;
      const git = new InMemoryGitRepo({ now: () => (time += MINUTE) });
      const { configText, keyring } = await newRepoConfig(OLD_PASSPHRASE);
      const root = await commitFiles(git, {
        parent: null,
        files: {
          [REPO_CONFIG_PATH]: configText,
          [await encryptPath(keyring, ["N"])]: await encryptNote(keyring, "a"),
        },
        message: "Import notes",
        branch: MAIN_BRANCH,
      });
      const repo = repoOver(new FakeForgeAdapter({ repo: git }), keyring);
      const edited = await repo.save(update(["N"], "b"));
      const { dates } = setup(repo);

      expect(await resolve(dates, repo, ["N"])).toEqual({
        created: { at: repo.timeOf(root), exact: true },
        updated: repo.timeOf(edited),
      });
    });

    it("dates a note whose history ends in a passphrase change as created before that change", async () => {
      const fixture = await createRekeyFixture();
      await repoOver(fixture.adapter, fixture.oldKeyring).save(
        update(["Welcome"], "before"),
      );
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
        removeHistory: false,
      });
      if (!prepared.ok) throw new Error(prepared.failure.kind);
      const changed = await commitPassphraseChange(deps, prepared.prepared);
      if (!changed.ok) throw new Error(changed.failure.kind);
      engine.dispose();
      const rekeyed = await fixture.adapter.getHead();
      const repo = repoOver(fixture.adapter, changed.keyring);
      const edited = await repo.save(update(["Welcome"], "after"));
      const { dates } = setup(repo);

      expect(await resolve(dates, repo, ["Welcome"])).toEqual({
        created: { at: repo.timeOf(rekeyed), exact: false },
        updated: repo.timeOf(edited),
      });
    });

    it("dates a note renamed onto the name of a trashed cached note from its own creation", async () => {
      const repo = await createRepo();
      await repo.save(create(["A"], "a"));
      const { dates } = setup(repo);
      await resolve(dates, repo, ["A"]);
      await repo.save({ kind: "trash-note", path: ["A"], entryId: TRASH_ID });
      const created = await repo.save(create(["B"], "b"));
      const renamed = await repo.save({
        kind: "rename-note",
        from: ["B"],
        to: ["A"],
      });

      expect(await resolve(dates, repo, ["A"])).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(renamed),
      });
    });

    it("rejects a note without history", async () => {
      const repo = await createRepo();
      const { dates } = setup(repo);

      await expect(
        dates.resolve(["Missing"], await repo.adapter.getHead(), "blob"),
      ).rejects.toThrow("Note has no history");
      expect(dates.cached(["Missing"])).toBeNull();
    });

    it("stops listing at the cap and finds the creation through the oldest commit", async () => {
      const repo = await createRepo();
      const created = await repo.save(create(["N"], "0"));
      await repo.save({ kind: "rename-note", from: ["N"], to: ["M"] });
      const updates = NOTE_DATES_PAGE_SIZE * NOTE_DATES_MAX_LIST_REQUESTS + 5;
      let edited = "";
      for (let i = 1; i <= updates; i++) {
        edited = await repo.save(update(["M"], `${i}`));
      }
      const { dates, calls } = setup(repo);

      const result = await resolve(dates, repo, ["M"]);

      expect(result).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(edited),
      });
      expect(calls.listCommits).toHaveLength(NOTE_DATES_MAX_LIST_REQUESTS);
      expect(calls.findOldestCommit).toBe(2);
    }, 60_000);
  });

  describe("caching", () => {
    it("returns cached dates without requests while the blob is unchanged, even on a newer head", async () => {
      const repo = await createRepo();
      const created = await repo.save(
        create(["N"], "a"),
        create(["Other"], "x"),
      );
      const { dates, requests } = setup(repo);
      const first = await resolve(dates, repo, ["N"]);
      const before = requests();
      await repo.save(update(["Other"], "y"));

      const again = await resolve(dates, repo, ["N"]);

      expect(again).toEqual(first);
      expect(requests()).toBe(before);
      expect(dates.cached(["N"])).toEqual({
        blobSha: await repo.blobOf(["N"]),
        commitSha: created,
        dates: first,
      });
    });

    it("refreshes the last update with one listing when the blob changes", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const { dates, calls } = setup(repo);
      const first = await resolve(dates, repo, ["N"]);
      calls.listCommits.length = 0;
      const edited = await repo.save(update(["N"], "b"));

      const refreshed = await resolve(dates, repo, ["N"]);

      expect(refreshed).toEqual({
        created: first.created,
        updated: repo.timeOf(edited),
      });
      expect(calls.listCommits).toHaveLength(1);
      expect(calls.listCommits[0].limit).toBe(NOTE_DATES_PAGE_SIZE);
      expect(calls.findOldestCommit).toBe(0);
    });

    it("takes the re-creation as the new creation on refresh", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "old"));
      const { dates } = setup(repo);
      await resolve(dates, repo, ["N"]);
      await repo.save({ kind: "trash-note", path: ["N"], entryId: TRASH_ID });
      const recreated = await repo.save(create(["N"], "new"));

      expect(await resolve(dates, repo, ["N"])).toEqual({
        created: { at: repo.timeOf(recreated), exact: true },
        updated: repo.timeOf(recreated),
      });
    });

    it("takes a note re-created and edited under a cached note's name from its own creation on refresh", async () => {
      const repo = await createRepo();
      await repo.save(create(["A"], "a"));
      const { dates, calls } = setup(repo);
      await resolve(dates, repo, ["A"]);
      await repo.save({ kind: "trash-note", path: ["A"], entryId: TRASH_ID });
      const recreated = await repo.save(create(["A"], "b"));
      const edited = await repo.save(update(["A"], "c"));
      calls.listCommits.length = 0;

      const refreshed = await resolve(dates, repo, ["A"]);

      expect(refreshed).toEqual({
        created: { at: repo.timeOf(recreated), exact: true },
        updated: repo.timeOf(edited),
      });
      expect(calls.listCommits).toHaveLength(1);
    });

    it("resolves in full when the commit the cached dates were resolved at is beyond the refresh listing", async () => {
      const repo = await createRepo();
      const created = await repo.save(create(["N"], "0"));
      const { dates, calls } = setup(repo);
      await resolve(dates, repo, ["N"]);
      let edited = "";
      for (let i = 1; i <= NOTE_DATES_PAGE_SIZE; i++) {
        edited = await repo.save(update(["N"], `${i}`));
      }
      calls.listCommits.length = 0;

      const refreshed = await resolve(dates, repo, ["N"]);

      expect(refreshed).toEqual({
        created: { at: repo.timeOf(created), exact: true },
        updated: repo.timeOf(edited),
      });
      const [refreshListing, fullListing] = calls.listCommits;
      expect(refreshListing).toMatchObject({
        from: edited,
        limit: NOTE_DATES_PAGE_SIZE,
      });
      expect(fullListing).toMatchObject({ from: edited });
    }, 60_000);

    it("shares one resolution between concurrent calls", async () => {
      const repo = await createRepo();
      await repo.save(create(["N"], "a"));
      const { dates, calls } = setup(repo);
      const head = await repo.adapter.getHead();
      const blobSha = await repo.blobOf(["N"]);

      const [one, two] = await Promise.all([
        dates.resolve(["N"], head, blobSha),
        dates.resolve(["N"], head, blobSha),
      ]);

      expect(two).toEqual(one);
      expect(calls.listCommits).toHaveLength(1);
    });

    it("evicts the least recently resolved note beyond the cache size", async () => {
      const repo = await createRepo();
      const names = Array.from(
        { length: NOTE_DATES_CACHE_SIZE + 1 },
        (_, i) => `N${i}`,
      );
      await repo.save(...names.map((name) => create([name], name)));
      const { dates } = setup(repo);

      for (const name of names) await resolve(dates, repo, [name]);

      expect(dates.cached(["N0"])).toBeNull();
      expect(dates.cached(["N1"])).not.toBeNull();
      expect(dates.cached([names.at(-1)!])).not.toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("pauses requests until the forge's retry time has passed", async () => {
      const repo = await createRepo();
      const created = await repo.save(create(["N"], "a"));
      const { dates, clock, requests } = setup(repo);
      repo.adapter.failNext(
        "listCommits",
        new ForgeError("RateLimited", { retryAfterMs: 30_000 }),
      );

      await expect(resolve(dates, repo, ["N"])).rejects.toMatchObject({
        kind: "RateLimited",
      });
      const afterFailure = requests();
      clock.advance(10_000);
      await expect(resolve(dates, repo, ["N"])).rejects.toMatchObject({
        kind: "RateLimited",
        retryAfterMs: 20_000,
      });
      const paused = requests();
      expect(dates.cached(["N"])).toBeNull();
      clock.advance(20_000);
      const resolved = await resolve(dates, repo, ["N"]);

      expect(paused).toBe(afterFailure);
      expect(resolved.created).toEqual({
        at: repo.timeOf(created),
        exact: true,
      });
    });
  });
});
