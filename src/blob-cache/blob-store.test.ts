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
import { describeBlobStoreContract } from "./testing/blob-store-contract";

class ThrowingIDBFactory {
  open(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }

  deleteDatabase(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }
}

const REPO = "github:alice/notes";

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(BLOB_CACHE_DB_NAME, 2);
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

describeBlobStoreContract("indexeddb blob store", () => {
  vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
  const factory = new IDBFactory();
  return (capBytes) => createBlobStore({ indexedDB: factory, capBytes });
});

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
      content: "v1:héllo",
      size: 9,
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
    expect(raw).toEqual({ content: "v1:héllo", size: 9, lastUsedAt: 1000 });
    const store2 = db.transaction("blobs", "readonly").objectStore("blobs");
    expect(store2.indexNames.contains("lastUsedAt")).toBe(true);
    db.close();
    store.close();
  });

  it("exposes the 128 MiB cap constant", () => {
    expect(BLOB_CACHE_CAP_BYTES).toBe(128 * 1024 * 1024);
  });

  it("drops a version 1 database's rows on upgrade", async () => {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(BLOB_CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const created = request.result.createObjectStore("blobs");
        created.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await rawPut(legacy, [REPO, "old"], { text: "v1:a", bytes: 4, lastUsedAt: 1 });
    legacy.close();

    const store = createBlobStore({ indexedDB: factory });
    expect(await store.get(REPO, "old")).toBeNull();
    await store.put(REPO, "new", "v1:b", 2);
    expect(await store.get(REPO, "new")).toMatchObject({ content: "v1:b" });
    store.close();

    const db = await openRaw(factory);
    expect(
      db.transaction("blobs", "readonly").objectStore("blobs").indexNames.contains("lastUsedAt"),
    ).toBe(true);
    expect(await rawCount(db)).toBe(1);
    db.close();
  });

  describe("failure handling", () => {
    it("deletes the database and returns null for a corrupt value", async () => {
      const seed = createBlobStore({ indexedDB: factory });
      await seed.put(REPO, "good", "v1:a", 1);
      seed.close();

      const db = await openRaw(factory);
      await rawPut(db, [REPO, "bad"], { content: 42, size: "x" });
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
          if ((args[0] as { content?: string }).content === "quota!") {
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
          if ((args[0] as { content?: string }).content === "boom") {
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
