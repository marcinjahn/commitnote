import { decryptNote, encryptNote } from "../crypto/note-cipher";
import type { Keyring } from "../crypto/keyring";
import { parseEarlyDraft, type EarlyDraft } from "../app/early-draft";

export const EARLY_DRAFT_DB_NAME = "commitnote-early-draft";

const DB_VERSION = 1;
const STORE_NAME = "drafts";

interface StoredRecord {
  readonly ciphertext: string;
  readonly savedAt: number;
}

export interface EarlyDraftStore {
  save(repoKey: string, keyring: Keyring, draft: EarlyDraft): Promise<void>;
  load(repoKey: string, keyring: Keyring): Promise<EarlyDraft | null>;
  remove(repoKey: string): Promise<void>;
}

function resolveFactory(explicit?: IDBFactory): IDBFactory | null {
  try {
    return explicit ?? globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

export function deleteEarlyDraftDatabase(indexedDB?: IDBFactory): Promise<void> {
  return new Promise((resolve) => {
    const factory = resolveFactory(indexedDB);
    if (!factory) {
      resolve();
      return;
    }
    try {
      const request = factory.deleteDatabase(EARLY_DRAFT_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function wrapTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(EARLY_DRAFT_DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ciphertext === "string" && typeof record.savedAt === "number"
  );
}

export function createEarlyDraftStore(options?: {
  readonly indexedDB?: IDBFactory;
}): EarlyDraftStore {
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function getDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    const factory = resolveFactory(options?.indexedDB);
    dbPromise = factory
      ? openDatabase(factory).catch(() => null)
      : Promise.resolve(null);
    return dbPromise;
  }

  async function readRecord(repoKey: string): Promise<unknown> {
    const db = await getDb();
    if (!db) return undefined;
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      return await wrapRequest(transaction.objectStore(STORE_NAME).get(repoKey));
    } catch {
      return undefined;
    }
  }

  async function deleteRecord(repoKey: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(repoKey);
      await wrapTransaction(transaction);
    } catch {
      // Treated as an unavailable store.
    }
  }

  return {
    async save(repoKey, keyring, draft) {
      try {
        const record: StoredRecord = {
          ciphertext: await encryptNote(keyring, JSON.stringify(draft)),
          savedAt: Date.now(),
        };
        const db = await getDb();
        if (!db) return;
        const transaction = db.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(record, repoKey);
        await wrapTransaction(transaction);
      } catch {
        // Treated as an unavailable store.
      }
    },

    async load(repoKey, keyring) {
      const record = await readRecord(repoKey);
      if (record === undefined) return null;
      if (!isStoredRecord(record)) {
        await deleteRecord(repoKey);
        return null;
      }
      try {
        const draft = parseEarlyDraft(
          JSON.parse(await decryptNote(keyring, record.ciphertext)),
        );
        if (draft) return draft;
      } catch {
        // Falls through to discarding the unreadable record.
      }
      await deleteRecord(repoKey);
      return null;
    },

    async remove(repoKey) {
      await deleteRecord(repoKey);
    },
  };
}
