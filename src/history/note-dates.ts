import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { encryptPath } from "../crypto/name-cipher";
import { ForgeError, isForgeError } from "../forge/errors";
import type { CommitSummary, ForgeAdapter } from "../forge/forge-adapter";
import type { Clock } from "../sync/clock";
import { createChainStep } from "./chain-step";
import { Lru } from "./lru";

export interface NoteDates {
  created: { at: number; exact: boolean };
  updated: number;
}

export interface NoteDatesDeps {
  adapter: Pick<
    ForgeAdapter,
    "listCommits" | "findOldestCommit" | "readFileAt" | "listTree"
  >;
  keyring: Keyring;
  clock: Clock;
}

export interface CachedNoteDates {
  blobSha: string;
  /** The newest commit at the note's path when the dates were resolved. */
  commitSha: string;
  dates: NoteDates;
}

interface Resolution {
  commitSha: string;
  dates: NoteDates;
}

export interface NoteDatesResolver {
  cached(notePath: NotePath): CachedNoteDates | null;
  forget(notePath: NotePath): void;
  resolve(
    notePath: NotePath,
    head: string,
    blobSha: string,
  ): Promise<NoteDates>;
}

export const NOTE_DATES_CACHE_SIZE = 50;
export const NOTE_DATES_PAGE_SIZE = 100;
export const NOTE_DATES_MAX_LIST_REQUESTS = 3;
export const NOTE_DATES_MAX_OLDEST_HOPS = 10;

const DEFAULT_RETRY_AFTER_MS = 60_000;

type Created = NoteDates["created"];

const exactAt = (commit: CommitSummary): Created => ({
  at: commit.committedAt,
  exact: true,
});

const before = (commit: CommitSummary): Created => ({
  at: commit.committedAt,
  exact: false,
});

export function createNoteDates(deps: NoteDatesDeps): NoteDatesResolver {
  const { adapter, keyring, clock } = deps;
  const cache = new Lru<CachedNoteDates>(NOTE_DATES_CACHE_SIZE);
  const inFlight = new Map<string, Promise<NoteDates>>();
  const generations = new Map<string, number>();
  const latest = new Map<string, Promise<NoteDates>>();
  let pausedUntil = 0;

  const supersede = (key: string): number => {
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    latest.delete(key);
    return generation;
  };

  async function guarded<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (isForgeError(error, "RateLimited")) {
        pausedUntil =
          clock.now() + (error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
      }
      throw error;
    }
  }

  const listCommits: ForgeAdapter["listCommits"] = (request) =>
    guarded(() => adapter.listCommits(request));
  const findOldestCommit: ForgeAdapter["findOldestCommit"] = (request) =>
    guarded(() => adapter.findOldestCommit(request));
  const chainStep = createChainStep({
    readFileAt: (sha, path) => guarded(() => adapter.readFileAt(sha, path)),
    listTree: (sha) => guarded(() => adapter.listTree(sha)),
  });

  async function oldestFallback(
    start: { path: string; from: string },
    lastSeen: CommitSummary,
  ): Promise<Created> {
    let { path, from } = start;
    for (let hop = 0; hop < NOTE_DATES_MAX_OLDEST_HOPS; hop++) {
      const oldest = await findOldestCommit({ from, path });
      if (oldest === null) return exactAt(lastSeen);
      lastSeen = oldest;
      const step = await chainStep(oldest, path);
      switch (step.kind) {
        case "created":
        case "same":
          return exactAt(oldest);
        case "passphraseChanged":
        case "untraceable":
          return before(oldest);
        case "relocated": {
          const parent = oldest.parents[0];
          if (parent === undefined) return exactAt(oldest);
          path = step.previousPath;
          from = parent;
        }
      }
    }
    return before(lastSeen);
  }

  async function fullResolution(
    storedPath: string,
    head: string,
  ): Promise<Resolution> {
    let path = storedPath;
    let from = head;
    let page = await listCommits({ from, path, limit: NOTE_DATES_PAGE_SIZE });
    let listRequests = 1;
    const newest = page[0];
    if (newest === undefined) throw new Error("Note has no history");
    let lastSeen = newest;
    const dates = (created: Created): Resolution => ({
      commitSha: newest.sha,
      dates: { created, updated: newest.committedAt },
    });

    for (;;) {
      let relocated = false;
      for (const commit of page) {
        lastSeen = commit;
        const step = await chainStep(commit, path);
        if (step.kind === "created") return dates(exactAt(commit));
        if (step.kind === "passphraseChanged" || step.kind === "untraceable") {
          return dates(before(commit));
        }
        const parent = commit.parents[0];
        if (parent === undefined) return dates(exactAt(commit));
        if (step.kind === "relocated") {
          path = step.previousPath;
          from = parent;
          relocated = true;
          break;
        }
      }

      if (!relocated) {
        const parent = lastSeen.parents[0];
        if (page.length < NOTE_DATES_PAGE_SIZE || parent === undefined) {
          return dates(exactAt(lastSeen));
        }
        from = parent;
      }

      if (listRequests === NOTE_DATES_MAX_LIST_REQUESTS) {
        return dates(await oldestFallback({ path, from }, lastSeen));
      }
      page = await listCommits({ from, path, limit: NOTE_DATES_PAGE_SIZE });
      listRequests++;
      if (page.length === 0) return dates(exactAt(lastSeen));
    }
  }

  async function refresh(
    storedPath: string,
    head: string,
    previous: CachedNoteDates,
  ): Promise<Resolution> {
    const page = await listCommits({
      from: head,
      path: storedPath,
      limit: NOTE_DATES_PAGE_SIZE,
    });
    const newest = page[0];
    if (newest === undefined) return fullResolution(storedPath, head);
    const resolution = (created: Created): Resolution => ({
      commitSha: newest.sha,
      dates: { created, updated: newest.committedAt },
    });
    for (const commit of page) {
      if (commit.sha === previous.commitSha) {
        return resolution(previous.dates.created);
      }
      const step = await chainStep(commit, storedPath);
      if (step.kind === "created") return resolution(exactAt(commit));
      if (step.kind !== "same") break;
    }
    return fullResolution(storedPath, head);
  }

  async function run(
    notePath: NotePath,
    key: string,
    generation: number,
    head: string,
    blobSha: string,
  ): Promise<NoteDates> {
    const storedPath = await encryptPath(keyring, notePath);
    const previous = cache.get(key);
    const { commitSha, dates } =
      previous === undefined
        ? await fullResolution(storedPath, head)
        : await refresh(storedPath, head, previous);
    if (generations.get(key) !== generation) {
      return latest.get(key) ?? dates;
    }
    cache.set(key, { blobSha, commitSha, dates });
    return dates;
  }

  return {
    cached(notePath) {
      return cache.get(JSON.stringify(notePath)) ?? null;
    },

    forget(notePath) {
      const key = JSON.stringify(notePath);
      supersede(key);
      cache.delete(key);
    },

    resolve(notePath, head, blobSha) {
      const key = JSON.stringify(notePath);
      const entry = cache.get(key);
      if (entry !== undefined && entry.blobSha === blobSha) {
        return Promise.resolve(entry.dates);
      }
      const flightKey = JSON.stringify([notePath, blobSha]);
      const pending = inFlight.get(flightKey);
      if (pending !== undefined) return pending;
      const now = clock.now();
      if (now < pausedUntil) {
        return Promise.reject(
          new ForgeError("RateLimited", { retryAfterMs: pausedUntil - now }),
        );
      }
      const generation = supersede(key);
      const promise = run(notePath, key, generation, head, blobSha).finally(
        () => {
          inFlight.delete(flightKey);
        },
      );
      latest.set(key, promise);
      inFlight.set(flightKey, promise);
      return promise;
    },
  };
}
