import type { Keyring } from "../crypto/keyring";
import type { RepoCoordinates } from "../forge/repo-coordinates";
import { isForgeId } from "../forge/repo-coordinates";
import type { Session } from "./session";

const DB_NAME = "commitnote";
const DB_VERSION = 1;
const STORE_NAME = "session";
const RECORD_KEY = "current";
const RECORD_VERSION = 1;
const REPO_URL_STORAGE_KEY = "commitnote.repoUrl";
const FORGE_ID_STORAGE_KEY = "commitnote.forge";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface StoredRecord {
  readonly version: number;
  readonly repoUrl: string;
  readonly coordinates: RepoCoordinates;
  readonly accessToken: string;
  readonly keyring: Keyring;
}

export interface SessionStore {
  readonly current: Session | null;
  start(
    session: Session,
    options: { readonly rememberMe: boolean },
  ): Promise<{ readonly remembered: boolean }>;
  loadRememberedSession(): Promise<Session | null>;
  clear(): Promise<void>;
  lastRepoUrl(): string | null;
  lastForgeId(): string | null;
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
      request = factory.open(DB_NAME, DB_VERSION);
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isWellFormedRecord(value: unknown): value is StoredRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== RECORD_VERSION) return false;
  if (typeof record.repoUrl !== "string") return false;
  if (typeof record.accessToken !== "string") return false;

  const coordinates = record.coordinates as Record<string, unknown> | null;
  if (
    typeof coordinates !== "object" ||
    coordinates === null ||
    !isForgeId(coordinates.forge) ||
    typeof coordinates.owner !== "string" ||
    typeof coordinates.repo !== "string"
  ) {
    return false;
  }

  const keyring = record.keyring as Record<string, unknown> | null;
  if (typeof keyring !== "object" || keyring === null) return false;
  const keyringFields = [
    "contentKey",
    "nameKey",
    "nameIvKey",
    "keyCheckKey",
  ] as const;
  return keyringFields.every((field) => keyring[field] instanceof CryptoKey);
}

export function createSessionStore(options?: {
  readonly indexedDB?: IDBFactory;
  readonly storage?: StorageLike;
}): SessionStore {
  let current: Session | null = null;
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function getFactory(): IDBFactory | null {
    try {
      return options?.indexedDB ?? globalThis.indexedDB ?? null;
    } catch {
      return null;
    }
  }

  function getStorage(): StorageLike | null {
    try {
      return options?.storage ?? globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  function getDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    const factory = getFactory();
    if (!factory) {
      dbPromise = Promise.resolve(null);
      return dbPromise;
    }
    dbPromise = openDatabase(factory).catch(() => null);
    return dbPromise;
  }

  function readItem(key: string): string | null {
    const storage = getStorage();
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeLastLogin(session: Session): void {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(REPO_URL_STORAGE_KEY, session.repoUrl);
      storage.setItem(FORGE_ID_STORAGE_KEY, session.coordinates.forge);
    } catch {
      // Treated as an unavailable store: the in-memory session still starts.
    }
  }

  async function putRecord(record: StoredRecord): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record, RECORD_KEY);
      await wrapTransaction(transaction);
      return true;
    } catch {
      return false;
    }
  }

  async function deleteRecord(): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(RECORD_KEY);
      await wrapTransaction(transaction);
    } catch {
      // Treated as an unavailable store.
    }
  }

  async function readRecord(): Promise<unknown> {
    const db = await getDb();
    if (!db) return undefined;
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      return await wrapRequest(store.get(RECORD_KEY));
    } catch {
      return undefined;
    }
  }

  return {
    get current() {
      return current;
    },

    async start(session, { rememberMe }) {
      current = session;
      writeLastLogin(session);

      if (!rememberMe) {
        await deleteRecord();
        return { remembered: false };
      }

      const record: StoredRecord = {
        version: RECORD_VERSION,
        repoUrl: session.repoUrl,
        coordinates: session.coordinates,
        accessToken: session.accessToken,
        keyring: session.keyring,
      };
      const remembered = await putRecord(record);
      return { remembered };
    },

    async loadRememberedSession() {
      const record = await readRecord();
      if (record === undefined) return null;
      if (!isWellFormedRecord(record)) {
        await deleteRecord();
        return null;
      }

      const session: Session = {
        repoUrl: record.repoUrl,
        coordinates: record.coordinates,
        accessToken: record.accessToken,
        keyring: record.keyring,
      };
      current = session;
      return session;
    },

    async clear() {
      current = null;
      await deleteRecord();
    },

    lastRepoUrl() {
      return readItem(REPO_URL_STORAGE_KEY);
    },

    lastForgeId() {
      return readItem(FORGE_ID_STORAGE_KEY);
    },
  };
}
