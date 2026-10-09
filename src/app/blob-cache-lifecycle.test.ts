import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBlobStore, BLOB_CACHE_DB_NAME } from "../blob-cache/blob-store";
import { gitBlobSha } from "../forge/git-blob-sha";
import type { RepoCoordinates } from "../forge/repo-coordinates";
import type { IndexStatus } from "../search/content-indexer";
import {
  openSessionBlobCache,
  purgeBlobCacheNow,
  purgeBlobCacheWhenIndexed,
} from "./blob-cache-lifecycle";

const COORDINATES: RepoCoordinates = {
  forge: "github",
  owner: "alice",
  repo: "notes",
};
const OTHER_REPO_KEY = "gitlab:bob/other";
const clock = { now: () => 5000 };

async function databaseNames(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map((info) => info.name ?? "");
}

function createFakeIndexer(initial: IndexStatus["kind"]) {
  let kind = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => ({ status: { kind } as IndexStatus, unreadable: 0 }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(next: IndexStatus["kind"]) {
      kind = next;
      for (const listener of listeners) listener();
    },
  };
}

function createFakeCache() {
  const purge = vi.fn((_referenced: ReadonlySet<string>, _snapshot: number) =>
    Promise.resolve(),
  );
  return { purge };
}

describe("openSessionBlobCache", () => {
  beforeAll(() => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
  });

  it("deletes the blob cache database and returns null for a non-remembered session", async () => {
    const indexedDB = new IDBFactory();
    const seed = createBlobStore({ indexedDB });
    await seed.put("github:alice/notes", "sha", "text", 1);
    seed.close();
    expect(await databaseNames(indexedDB)).toContain(BLOB_CACHE_DB_NAME);

    const cache = await openSessionBlobCache({
      remembered: false,
      coordinates: COORDINATES,
      clock,
      indexedDB,
    });

    expect(cache).toBeNull();
    expect(await databaseNames(indexedDB)).not.toContain(BLOB_CACHE_DB_NAME);
  });

  it("returns a cache for a remembered session and drops other repositories' entries", async () => {
    const indexedDB = new IDBFactory();
    const ownText = "own ciphertext";
    const ownSha = await gitBlobSha(ownText);
    const seed = createBlobStore({ indexedDB });
    await seed.put("github:alice/notes", ownSha, ownText, 1);
    await seed.put(OTHER_REPO_KEY, "other-sha", "other ciphertext", 1);
    seed.close();

    const cache = await openSessionBlobCache({
      remembered: true,
      coordinates: COORDINATES,
      clock,
      indexedDB,
    });

    expect(cache).not.toBeNull();
    expect(await cache?.read(ownSha)).toBe(ownText);
    await cache?.dispose();
    const check = createBlobStore({ indexedDB });
    expect(await check.get(OTHER_REPO_KEY, "other-sha")).toBeNull();
    expect(await check.get("github:alice/notes", ownSha)).not.toBeNull();
    check.close();
  });
});

describe("purgeBlobCacheNow", () => {
  it("purges against the engine's referenced set at the current time", () => {
    const referenced = new Set(["a", "b"]);
    const cache = createFakeCache();

    purgeBlobCacheNow({
      engine: { referencedBlobShas: () => referenced },
      cache,
      clock,
    });

    expect(cache.purge).toHaveBeenCalledExactlyOnceWith(referenced, 5000);
  });

  it("does nothing while the referenced set is unknown", () => {
    const cache = createFakeCache();

    purgeBlobCacheNow({
      engine: { referencedBlobShas: () => null },
      cache,
      clock,
    });

    expect(cache.purge).not.toHaveBeenCalled();
  });
});

describe("purgeBlobCacheWhenIndexed", () => {
  const referenced = new Set(["a"]);
  const engine = { referencedBlobShas: () => referenced };

  it("purges once per transition into complete", () => {
    const indexer = createFakeIndexer("idle");
    const cache = createFakeCache();
    purgeBlobCacheWhenIndexed({ indexer, engine, cache, clock });

    indexer.emit("indexing");
    expect(cache.purge).not.toHaveBeenCalled();
    indexer.emit("complete");
    indexer.emit("complete");
    expect(cache.purge).toHaveBeenCalledExactlyOnceWith(referenced, 5000);

    indexer.emit("indexing");
    indexer.emit("complete");
    expect(cache.purge).toHaveBeenCalledTimes(2);
  });

  it("does not purge on notifications when the initial state is already complete", () => {
    const indexer = createFakeIndexer("complete");
    const cache = createFakeCache();
    purgeBlobCacheWhenIndexed({ indexer, engine, cache, clock });

    indexer.emit("complete");

    expect(cache.purge).not.toHaveBeenCalled();
  });

  it("skips the purge while the referenced set is unknown", () => {
    const indexer = createFakeIndexer("indexing");
    const cache = createFakeCache();
    purgeBlobCacheWhenIndexed({
      indexer,
      engine: { referencedBlobShas: () => null },
      cache,
      clock,
    });

    indexer.emit("complete");

    expect(cache.purge).not.toHaveBeenCalled();
  });

  it("stops purging after unsubscribing", () => {
    const indexer = createFakeIndexer("indexing");
    const cache = createFakeCache();
    const unsubscribe = purgeBlobCacheWhenIndexed({
      indexer,
      engine,
      cache,
      clock,
    });

    unsubscribe();
    indexer.emit("complete");

    expect(cache.purge).not.toHaveBeenCalled();
  });
});
