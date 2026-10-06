export const BLOB_CACHE_DB_NAME = "commitnote-blobs";
export const BLOB_CACHE_CAP_BYTES = 64 * 1024 * 1024;

const DB_VERSION = 1;
const STORE_NAME = "blobs";
const LAST_USED_INDEX = "lastUsedAt";

export interface BlobStoreEntry {
  readonly text: string;
  readonly bytes: number;
  readonly lastUsedAt: number;
}

export interface BlobStore {
  get(repoKey: string, blobSha: string): Promise<BlobStoreEntry | null>;
  touch(repoKey: string, blobSha: string, lastUsedAt: number): Promise<void>;
  put(
    repoKey: string,
    blobSha: string,
    text: string,
    lastUsedAt: number,
  ): Promise<void>;
  delete(repoKey: string, blobSha: string): Promise<void>;
  deleteUnreferenced(
    repoKey: string,
    referenced: ReadonlySet<string>,
    before: number,
  ): Promise<void>;
  deleteRepo(repoKey: string): Promise<void>;
  deleteOtherRepos(repoKey: string): Promise<void>;
  close(): void;
}

class CorruptionError extends Error {}

function resolveFactory(explicit?: IDBFactory): IDBFactory | null {
  try {
    return explicit ?? globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

export function deleteBlobCacheDatabase(indexedDB?: IDBFactory): Promise<void> {
  return new Promise((resolve) => {
    const factory = resolveFactory(indexedDB);
    if (!factory) {
      resolve();
      return;
    }
    try {
      const request = factory.deleteDatabase(BLOB_CACHE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function isEntry(value: unknown): value is BlobStoreEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.text === "string" &&
    typeof record.bytes === "number" &&
    typeof record.lastUsedAt === "number"
  );
}

function isQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "QuotaExceededError"
  );
}

function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fallback: T,
  body: (
    store: IDBObjectStore,
    setResult: (value: T) => void,
    abort: (reason: unknown) => void,
    guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STORE_NAME, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result = fallback;
    let failed = false;
    let failure: unknown;
    const abort = (reason: unknown) => {
      if (failed) return;
      failed = true;
      failure = reason;
      try {
        transaction.abort();
      } catch {
        // Already finished.
      }
    };
    const guard =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        if (failed) return;
        try {
          fn(...args);
        } catch (error) {
          abort(error);
        }
      };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failed ? failure : transaction.error);
    guard(() =>
      body(
        transaction.objectStore(STORE_NAME),
        (value) => {
          result = value;
        },
        abort,
        guard,
      ),
    )();
  });
}

export function createBlobStore(options?: {
  readonly indexedDB?: IDBFactory;
  readonly capBytes?: number;
}): BlobStore {
  const capBytes = options?.capBytes ?? BLOB_CACHE_CAP_BYTES;
  const encoder = new TextEncoder();
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let currentDb: IDBDatabase | null = null;
  let unavailable = false;
  let total: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function becomeUnavailable(): void {
    unavailable = true;
    try {
      currentDb?.close();
    } catch {
      // Already closed.
    }
  }

  async function discardDatabase(): Promise<void> {
    becomeUnavailable();
    await deleteBlobCacheDatabase(resolveFactory(options?.indexedDB) ?? undefined);
  }

  function openDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(BLOB_CACHE_DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME);
          store.createIndex(LAST_USED_INDEX, "lastUsedAt", { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          unavailable = true;
        };
        currentDb = db;
        resolve(db);
      };
      request.onerror = () => {
        void discardDatabase().then(() => resolve(null));
      };
    });
  }

  function getDb(): Promise<IDBDatabase | null> {
    if (unavailable) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    const factory = resolveFactory(options?.indexedDB);
    dbPromise = factory ? openDatabase(factory) : Promise.resolve(null);
    return dbPromise;
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  async function ensureTotal(db: IDBDatabase): Promise<number> {
    if (total !== null) return total;
    const sum = await runTransaction(db, "readonly", 0, (store, setResult, abort, guard) => {
      let running = 0;
      const request = store.openCursor();
      request.onsuccess = guard(() => {
        const cursor = request.result;
        if (!cursor) {
          setResult(running);
          return;
        }
        if (!isEntry(cursor.value)) {
          abort(new CorruptionError());
          return;
        }
        running += cursor.value.bytes;
        cursor.continue();
      });
    });
    total = sum;
    return sum;
  }

  async function evictToHalf(db: IDBDatabase): Promise<void> {
    const start = await ensureTotal(db);
    const target = capBytes / 2;
    await runTransaction(db, "readwrite", 0, (store, _set, abort, guard) => {
      let remaining = start;
      const request = store.index(LAST_USED_INDEX).openCursor();
      request.onsuccess = guard(() => {
        const cursor = request.result;
        if (!cursor || remaining <= target) return;
        if (!isEntry(cursor.value)) {
          abort(new CorruptionError());
          return;
        }
        remaining -= cursor.value.bytes;
        cursor.delete();
        cursor.continue();
      });
    });
    total = null;
  }

  async function handleFailure(db: IDBDatabase, error: unknown): Promise<void> {
    if (isQuotaError(error)) {
      try {
        await evictToHalf(db);
        return;
      } catch {
        // Falls through to discarding the database.
      }
    }
    await discardDatabase();
  }

  async function run(
    operation: (db: IDBDatabase) => Promise<void>,
  ): Promise<void> {
    try {
      const db = await getDb();
      if (!db || unavailable) return;
      try {
        await operation(db);
      } catch (error) {
        await handleFailure(db, error);
      }
    } catch {
      // Cache failures behave as misses.
    }
  }

  function repoRange(repoKey: string): IDBKeyRange {
    return IDBKeyRange.bound([repoKey], [repoKey, []]);
  }

  return {
    get(repoKey, blobSha) {
      return enqueue(async () => {
        let entry: BlobStoreEntry | null = null;
        await run(async (db) => {
          const value = await runTransaction<unknown>(
            db,
            "readonly",
            undefined,
            (store, setResult, _abort, guard) => {
              const request = store.get([repoKey, blobSha]);
              request.onsuccess = guard(() => setResult(request.result));
            },
          );
          if (value === undefined) return;
          if (!isEntry(value)) throw new CorruptionError();
          entry = {
            text: value.text,
            bytes: value.bytes,
            lastUsedAt: value.lastUsedAt,
          };
        });
        return entry;
      });
    },

    touch(repoKey, blobSha, lastUsedAt) {
      return enqueue(() =>
        run(async (db) => {
          await runTransaction(db, "readwrite", undefined, (store, _set, abort, guard) => {
            const key = [repoKey, blobSha];
            const request = store.get(key);
            request.onsuccess = guard(() => {
              const value: unknown = request.result;
              if (value === undefined) return;
              if (!isEntry(value)) {
                abort(new CorruptionError());
                return;
              }
              store.put(
                { text: value.text, bytes: value.bytes, lastUsedAt },
                key,
              );
            });
          });
        }),
      );
    },

    put(repoKey, blobSha, text, lastUsedAt) {
      return enqueue(() =>
        run(async (db) => {
          const bytes = encoder.encode(text).length;
          if (bytes > capBytes) return;
          const before = await ensureTotal(db);
          const key = [repoKey, blobSha];
          let after = before;
          await runTransaction(db, "readwrite", undefined, (store, _set, abort, guard) => {
            const existing = store.get(key);
            existing.onsuccess = guard(() => {
              const old: unknown = existing.result;
              let projected = before;
              if (old !== undefined) {
                if (!isEntry(old)) {
                  abort(new CorruptionError());
                  return;
                }
                projected -= old.bytes;
              }
              const write = () => {
                store.put({ text, bytes, lastUsedAt }, key);
                after = projected + bytes;
              };
              if (projected + bytes <= capBytes) {
                write();
                return;
              }
              const cursorRequest = store.index(LAST_USED_INDEX).openCursor();
              cursorRequest.onsuccess = guard(() => {
                const cursor = cursorRequest.result;
                if (!cursor || projected + bytes <= capBytes) {
                  write();
                  return;
                }
                const [cursorRepo, cursorSha] = cursor.primaryKey as [
                  string,
                  string,
                ];
                if (cursorRepo !== repoKey || cursorSha !== blobSha) {
                  if (!isEntry(cursor.value)) {
                    abort(new CorruptionError());
                    return;
                  }
                  projected -= cursor.value.bytes;
                  cursor.delete();
                }
                cursor.continue();
              });
            });
          });
          total = after;
        }),
      );
    },

    delete(repoKey, blobSha) {
      return enqueue(() =>
        run(async (db) => {
          let freed = 0;
          await runTransaction(db, "readwrite", undefined, (store, _set, abort, guard) => {
            const key = [repoKey, blobSha];
            const request = store.get(key);
            request.onsuccess = guard(() => {
              const value: unknown = request.result;
              if (value === undefined) return;
              if (!isEntry(value)) {
                abort(new CorruptionError());
                return;
              }
              freed = value.bytes;
              store.delete(key);
            });
          });
          if (total !== null) total -= freed;
        }),
      );
    },

    deleteUnreferenced(repoKey, referenced, before) {
      return enqueue(() =>
        run(async (db) => {
          let freed = 0;
          await runTransaction(db, "readwrite", undefined, (store, _set, abort, guard) => {
            const request = store.openCursor(repoRange(repoKey));
            request.onsuccess = guard(() => {
              const cursor = request.result;
              if (!cursor) return;
              if (!isEntry(cursor.value)) {
                abort(new CorruptionError());
                return;
              }
              const blobSha = (cursor.primaryKey as [string, string])[1];
              if (!referenced.has(blobSha) && cursor.value.lastUsedAt < before) {
                freed += cursor.value.bytes;
                cursor.delete();
              }
              cursor.continue();
            });
          });
          if (total !== null) total -= freed;
        }),
      );
    },

    deleteRepo(repoKey) {
      return enqueue(() =>
        run(async (db) => {
          await runTransaction(db, "readwrite", undefined, (store) => {
            store.delete(repoRange(repoKey));
          });
          total = null;
        }),
      );
    },

    deleteOtherRepos(repoKey) {
      return enqueue(() =>
        run(async (db) => {
          await runTransaction(db, "readwrite", undefined, (store) => {
            store.delete(IDBKeyRange.upperBound([repoKey], true));
            store.delete(IDBKeyRange.lowerBound([repoKey, []], true));
          });
          total = null;
        }),
      );
    },

    close() {
      becomeUnavailable();
      void dbPromise?.then((db) => db?.close());
    },
  };
}
