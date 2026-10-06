import {
  IDBFactory,
  IDBKeyRange as FakeIDBKeyRange,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOB_CACHE_CAP_BYTES,
  BLOB_CACHE_DB_NAME,
  createBlobStore,
  deleteBlobCacheDatabase,
} from "./blob-store";

class ThrowingIDBFactory {
  open(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }

  deleteDatabase(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }
}

const REPO = "github:alice/notes";
const OTHER_REPO = "gitlab:bob/other";

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(BLOB_CACHE_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function databaseNames(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map((info) => info.name ?? "");
}

function rawPut(db: IDBDatabase, key: string[], value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("blobs", "readwrite");
    transaction.objectStore("blobs").put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function rawCount(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("blobs", "readonly").objectStore("blobs").count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("blob store", () => {
  let factory: IDBFactory;

  beforeAll(() => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
  });

  beforeEach(() => {
    factory = new IDBFactory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips an entry with the exact value shape", async () => {
    const store = createBlobStore({ indexedDB: factory });
    await store.put(REPO, "sha1", "v1:héllo", 1000);

    expect(await store.get(REPO, "sha1")).toEqual({
      text: "v1:héllo",
      bytes: 9,
      lastUsedAt: 1000,
    });

    const db = await openRaw(factory);
    const raw = await new Promise<unknown>((resolve) => {
      const request = db
        .transaction("blobs", "readonly")
        .objectStore("blobs")
        .get([REPO, "sha1"]);
      request.onsuccess = () => resolve(request.result);
    });
    expect(raw).toEqual({ text: "v1:héllo", bytes: 9, lastUsedAt: 1000 });
    const store2 = db.transaction("blobs", "readonly").objectStore("blobs");
    expect(store2.indexNames.contains("lastUsedAt")).toBe(true);
    db.close();
    store.close();
  });

  it("returns null for a missing entry and does not touch on get", async () => {
    const store = createBlobStore({ indexedDB: factory });
    expect(await store.get(REPO, "missing")).toBeNull();
    await store.put(REPO, "a", "v1:a", 5);
    await store.get(REPO, "a");
    expect((await store.get(REPO, "a"))?.lastUsedAt).toBe(5);
    store.close();
  });

  it("touch rewrites lastUsedAt of an existing entry only", async () => {
    const store = createBlobStore({ indexedDB: factory });
    await store.put(REPO, "a", "v1:a", 5);
    await store.touch(REPO, "a", 99);
    await store.touch(REPO, "absent", 99);

    expect(await store.get(REPO, "a")).toEqual({
      text: "v1:a",
      bytes: 4,
      lastUsedAt: 99,
    });
    expect(await store.get(REPO, "absent")).toBeNull();
    store.close();
  });

  it("isolates entries by repoKey", async () => {
    const store = createBlobStore({ indexedDB: factory });
    await store.put(REPO, "same", "v1:one", 1);
    await store.put(OTHER_REPO, "same", "v1:two", 2);

    expect((await store.get(REPO, "same"))?.text).toBe("v1:one");
    expect((await store.get(OTHER_REPO, "same"))?.text).toBe("v1:two");
    await store.delete(REPO, "same");
    expect(await store.get(REPO, "same")).toBeNull();
    expect((await store.get(OTHER_REPO, "same"))?.text).toBe("v1:two");
    store.close();
  });

  it("exposes the 64 MiB cap constant", () => {
    expect(BLOB_CACHE_CAP_BYTES).toBe(64 * 1024 * 1024);
  });

  describe("LRU eviction", () => {
    it("evicts the oldest lastUsedAt first and keeps the new entry", async () => {
      const store = createBlobStore({ indexedDB: factory, capBytes: 10 });
      await store.put(REPO, "old", "1234", 10);
      await store.put(OTHER_REPO, "mid", "1234", 20);
      await store.put(REPO, "new", "123456", 30);

      expect(await store.get(REPO, "old")).toBeNull();
      expect(await store.get(OTHER_REPO, "mid")).not.toBeNull();
      expect(await store.get(REPO, "new")).not.toBeNull();

      await store.put(REPO, "newest", "1234", 40);
      expect(await store.get(OTHER_REPO, "mid")).toBeNull();
      expect(await store.get(REPO, "new")).not.toBeNull();
      expect(await store.get(REPO, "newest")).not.toBeNull();
      store.close();
    });

    it("respects touch when choosing the victim", async () => {
      const store = createBlobStore({ indexedDB: factory, capBytes: 8 });
      await store.put(REPO, "a", "1234", 10);
      await store.put(REPO, "b", "1234", 20);
      await store.touch(REPO, "a", 30);
      await store.put(REPO, "c", "1234", 40);

      expect(await store.get(REPO, "b")).toBeNull();
      expect(await store.get(REPO, "a")).not.toBeNull();
      store.close();
    });

    it("skips an entry larger than the cap", async () => {
      const store = createBlobStore({ indexedDB: factory, capBytes: 5 });
      await store.put(REPO, "small", "123", 1);
      await store.put(REPO, "huge", "123456", 2);

      expect(await store.get(REPO, "huge")).toBeNull();
      expect(await store.get(REPO, "small")).not.toBeNull();
      store.close();
    });

    it("does not double-count an overwrite", async () => {
      const store = createBlobStore({ indexedDB: factory, capBytes: 10 });
      await store.put(REPO, "a", "123456", 1);
      await store.put(REPO, "a", "654321", 2);
      await store.put(REPO, "b", "1234", 3);

      expect(await store.get(REPO, "a")).toEqual({
        text: "654321",
        bytes: 6,
        lastUsedAt: 2,
      });
      expect(await store.get(REPO, "b")).not.toBeNull();
      store.close();
    });

    it("sums existing entries when a new instance starts", async () => {
      const first = createBlobStore({ indexedDB: factory, capBytes: 10 });
      await first.put(REPO, "a", "123456", 1);
      first.close();

      const second = createBlobStore({ indexedDB: factory, capBytes: 10 });
      await second.put(REPO, "b", "123456", 2);
      expect(await second.get(REPO, "a")).toBeNull();
      expect(await second.get(REPO, "b")).not.toBeNull();
      second.close();
    });

    it("keeps accounting correct after deletes", async () => {
      const store = createBlobStore({ indexedDB: factory, capBytes: 10 });
      await store.put(REPO, "a", "123456", 1);
      await store.delete(REPO, "a");
      await store.put(REPO, "b", "123456", 2);
      await store.put(REPO, "c", "1234", 3);

      expect(await store.get(REPO, "b")).not.toBeNull();
      expect(await store.get(REPO, "c")).not.toBeNull();
      store.close();
    });
  });

  describe("bulk deletions", () => {
    it("deleteUnreferenced keeps referenced, recent and other-repo entries", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put(REPO, "referenced", "v1:a", 1);
      await store.put(REPO, "stale", "v1:b", 2);
      await store.put(REPO, "recent", "v1:c", 100);
      await store.put(OTHER_REPO, "stale", "v1:d", 2);
      await store.put("github:alice/notes2", "stale", "v1:e", 2);

      await store.deleteUnreferenced(REPO, new Set(["referenced"]), 100);

      expect(await store.get(REPO, "referenced")).not.toBeNull();
      expect(await store.get(REPO, "stale")).toBeNull();
      expect(await store.get(REPO, "recent")).not.toBeNull();
      expect(await store.get(OTHER_REPO, "stale")).not.toBeNull();
      expect(await store.get("github:alice/notes2", "stale")).not.toBeNull();
      store.close();
    });

    it("deleteRepo removes only that repo", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put(REPO, "a", "v1:a", 1);
      await store.put(REPO, "b", "v1:b", 2);
      await store.put(OTHER_REPO, "a", "v1:c", 3);
      await store.put("github:alice/notes2", "a", "v1:d", 3);

      await store.deleteRepo(REPO);

      expect(await store.get(REPO, "a")).toBeNull();
      expect(await store.get(REPO, "b")).toBeNull();
      expect(await store.get(OTHER_REPO, "a")).not.toBeNull();
      expect(await store.get("github:alice/notes2", "a")).not.toBeNull();
      store.close();
    });

    it("deleteOtherRepos keeps only that repo", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put("github:alice/aaa", "a", "v1:a", 1);
      await store.put(REPO, "a", "v1:b", 2);
      await store.put("github:alice/notes2", "a", "v1:c", 3);
      await store.put(OTHER_REPO, "a", "v1:d", 4);

      await store.deleteOtherRepos(REPO);

      expect(await store.get(REPO, "a")).not.toBeNull();
      expect(await store.get("github:alice/aaa", "a")).toBeNull();
      expect(await store.get("github:alice/notes2", "a")).toBeNull();
      expect(await store.get(OTHER_REPO, "a")).toBeNull();
      store.close();
    });
  });

  describe("failure handling", () => {
    it("deletes the database and returns null for a corrupt value", async () => {
      const seed = createBlobStore({ indexedDB: factory });
      await seed.put(REPO, "good", "v1:a", 1);
      seed.close();

      const db = await openRaw(factory);
      await rawPut(db, [REPO, "bad"], { text: 42, bytes: "x" });
      db.close();

      const store = createBlobStore({ indexedDB: factory });
      expect(await store.get(REPO, "bad")).toBeNull();
      expect(await databaseNames(factory)).not.toContain(BLOB_CACHE_DB_NAME);

      expect(await store.get(REPO, "good")).toBeNull();
      await store.put(REPO, "again", "v1:z", 5);
      expect(await databaseNames(factory)).not.toContain(BLOB_CACHE_DB_NAME);
    });

    it("resolves silently when the factory cannot open", async () => {
      const store = createBlobStore({
        indexedDB: new ThrowingIDBFactory() as unknown as IDBFactory,
      });

      expect(await store.get(REPO, "a")).toBeNull();
      await expect(store.put(REPO, "a", "v1:a", 1)).resolves.toBeUndefined();
      await expect(store.touch(REPO, "a", 2)).resolves.toBeUndefined();
      await expect(store.delete(REPO, "a")).resolves.toBeUndefined();
      await expect(
        store.deleteUnreferenced(REPO, new Set(), 10),
      ).resolves.toBeUndefined();
      await expect(store.deleteRepo(REPO)).resolves.toBeUndefined();
      await expect(store.deleteOtherRepos(REPO)).resolves.toBeUndefined();
      expect(() => store.close()).not.toThrow();
      await expect(
        deleteBlobCacheDatabase(new ThrowingIDBFactory() as unknown as IDBFactory),
      ).resolves.toBeUndefined();
    });

    it("drops the write and evicts to half the cap on quota errors", async () => {
      const store = createBlobStore({ indexedDB: factory, capBytes: 20 });
      await store.put(REPO, "a", "1234", 1);
      await store.put(REPO, "b", "1234", 2);
      await store.put(REPO, "c", "1234", 3);
      await store.put(REPO, "d", "1234", 4);

      const original = FakeIDBObjectStore.prototype.put;
      vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(
        function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
          if ((args[0] as { text?: string }).text === "quota!") {
            throw new DOMException("full", "QuotaExceededError");
          }
          return original.apply(this, args);
        },
      );

      await expect(store.put(REPO, "e", "quota!", 5)).resolves.toBeUndefined();
      vi.restoreAllMocks();

      expect(await store.get(REPO, "e")).toBeNull();
      expect(await store.get(REPO, "a")).toBeNull();
      expect(await store.get(REPO, "b")).toBeNull();
      expect(await store.get(REPO, "c")).not.toBeNull();
      expect(await store.get(REPO, "d")).not.toBeNull();
      expect(await databaseNames(factory)).toContain(BLOB_CACHE_DB_NAME);

      await store.put(REPO, "f", "1234", 6);
      expect(await store.get(REPO, "f")).not.toBeNull();
      store.close();
    });

    it("becomes unavailable and deletes the database on other transaction errors", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put(REPO, "a", "v1:a", 1);

      const original = FakeIDBObjectStore.prototype.put;
      vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(
        function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
          if ((args[0] as { text?: string }).text === "boom") {
            throw new DOMException("bad", "DataError");
          }
          return original.apply(this, args);
        },
      );
      await expect(store.put(REPO, "b", "boom", 2)).resolves.toBeUndefined();
      vi.restoreAllMocks();

      expect(await databaseNames(factory)).not.toContain(BLOB_CACHE_DB_NAME);
      expect(await store.get(REPO, "a")).toBeNull();
    });

    it("becomes unavailable after close", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put(REPO, "a", "v1:a", 1);
      store.close();

      expect(await store.get(REPO, "a")).toBeNull();
      await store.put(REPO, "b", "v1:b", 2);

      const db = await openRaw(factory);
      expect(await rawCount(db)).toBe(1);
      db.close();
    });

    it("does not block deleteDatabase from another connection", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put(REPO, "a", "v1:a", 1);

      await deleteBlobCacheDatabase(factory);

      expect(await databaseNames(factory)).not.toContain(BLOB_CACHE_DB_NAME);
      expect(await store.get(REPO, "a")).toBeNull();
    });
  });

  describe("deleteBlobCacheDatabase", () => {
    it("removes stored data", async () => {
      const store = createBlobStore({ indexedDB: factory });
      await store.put(REPO, "a", "v1:a", 1);
      store.close();

      await deleteBlobCacheDatabase(factory);

      const fresh = createBlobStore({ indexedDB: factory });
      expect(await fresh.get(REPO, "a")).toBeNull();
      fresh.close();
    });

    it("resolves even when another connection blocks the deletion", async () => {
      const db = await openRaw(factory);
      await expect(deleteBlobCacheDatabase(factory)).resolves.toBeUndefined();
      db.close();
    });
  });
});
