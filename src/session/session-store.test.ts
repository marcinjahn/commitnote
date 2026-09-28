import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import type { RepoCoordinates } from "../repo-url/parse-repo-url";
import { createSessionStore } from "./session-store";
import type { Session } from "./session";

class MemoryStorage implements Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class ThrowingStorage implements Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}

class ThrowingIDBFactory {
  open(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }
}

async function generateKeyring(): Promise<Keyring> {
  const [contentKey, nameKey, nameIvKey, keyCheckKey] = await Promise.all([
    crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
    crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]),
    crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]),
    crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]),
  ]);
  return { contentKey, nameKey, nameIvKey, keyCheckKey };
}

const coordinates: RepoCoordinates = {
  forge: "github",
  owner: "alice",
  repo: "notes",
};

async function makeSession(): Promise<Session> {
  return {
    repoUrl: "https://github.com/alice/notes",
    coordinates,
    accessToken: "gh-access-token",
    keyring: await generateKeyring(),
  };
}

describe("createSessionStore", () => {
  let indexedDB: IDBFactory;
  let storage: MemoryStorage;

  beforeEach(() => {
    indexedDB = new IDBFactory();
    storage = new MemoryStorage();
  });

  it("remembers a session across stores when Remember me is on", async () => {
    const session = await makeSession();
    const store = createSessionStore({ indexedDB, storage });

    const result = await store.start(session, { rememberMe: true });
    expect(result).toEqual({ remembered: true });

    const otherStore = createSessionStore({ indexedDB, storage });
    const loaded = await otherStore.loadRememberedSession();

    expect(loaded).not.toBeNull();
    expect(loaded?.repoUrl).toBe(session.repoUrl);
    expect(loaded?.coordinates).toEqual(session.coordinates);
    expect(loaded?.accessToken).toBe(session.accessToken);
    expect(otherStore.current).toBe(loaded);

    const loadedKeyring = loaded?.keyring;
    expect(loadedKeyring).toBeDefined();
    if (!loadedKeyring) throw new Error("unreachable");

    expect(loadedKeyring.contentKey).toBeInstanceOf(CryptoKey);
    expect(loadedKeyring.contentKey.extractable).toBe(false);
    expect(loadedKeyring.nameKey.extractable).toBe(false);
    expect(loadedKeyring.nameIvKey.extractable).toBe(false);
    expect(loadedKeyring.keyCheckKey.extractable).toBe(false);

    const plaintext = new TextEncoder().encode("hello git-notes");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      session.keyring.contentKey,
      plaintext,
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      loadedKeyring.contentKey,
      ciphertext,
    );
    expect(new Uint8Array(decrypted)).toEqual(plaintext);

    const message = new TextEncoder().encode("git-notes key check v1");
    const signature = await crypto.subtle.sign(
      "HMAC",
      session.keyring.keyCheckKey,
      message,
    );
    const verified = await crypto.subtle.verify(
      "HMAC",
      loadedKeyring.keyCheckKey,
      signature,
      message,
    );
    expect(verified).toBe(true);
  });

  it("does not remember a session when Remember me is off, but keeps the repo URL", async () => {
    const session = await makeSession();
    const store = createSessionStore({ indexedDB, storage });

    const result = await store.start(session, { rememberMe: false });
    expect(result).toEqual({ remembered: false });

    const otherStore = createSessionStore({ indexedDB, storage });
    const loaded = await otherStore.loadRememberedSession();
    expect(loaded).toBeNull();
    expect(otherStore.lastRepoUrl()).toBe(session.repoUrl);
  });

  it("removes a previously remembered record when starting again without Remember me", async () => {
    const session = await makeSession();
    const store = createSessionStore({ indexedDB, storage });

    await store.start(session, { rememberMe: true });
    await store.start(session, { rememberMe: false });

    const otherStore = createSessionStore({ indexedDB, storage });
    const loaded = await otherStore.loadRememberedSession();
    expect(loaded).toBeNull();
  });

  it("clears the current session and stored record but keeps the repo URL", async () => {
    const session = await makeSession();
    const store = createSessionStore({ indexedDB, storage });

    await store.start(session, { rememberMe: true });
    await store.clear();

    expect(store.current).toBeNull();
    expect(store.lastRepoUrl()).toBe(session.repoUrl);

    const otherStore = createSessionStore({ indexedDB, storage });
    const loaded = await otherStore.loadRememberedSession();
    expect(loaded).toBeNull();
  });

  it("stores no passphrase field and nothing beyond the decided layout", async () => {
    const session = await makeSession();
    const store = createSessionStore({ indexedDB, storage });
    await store.start(session, { rememberMe: true });

    const rawRecord = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open("git-notes", 1);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("session", "readonly");
        const getRequest = transaction.objectStore("session").get("current");
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
      };
      request.onerror = () => reject(request.error);
    });

    expect(rawRecord).toEqual({
      version: 1,
      repoUrl: session.repoUrl,
      coordinates: session.coordinates,
      accessToken: session.accessToken,
      keyring: session.keyring,
    });
    expect(Object.keys(rawRecord as Record<string, unknown>).sort()).toEqual(
      ["accessToken", "coordinates", "keyring", "repoUrl", "version"].sort(),
    );
    expect(JSON.stringify(rawRecord)).not.toContain("passphrase");
  });

  it("loads a malformed record as null and deletes it", async () => {
    const store = createSessionStore({ indexedDB, storage });

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("git-notes", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("session");
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("session", "readwrite");
        transaction
          .objectStore("session")
          .put(
            { version: 1, repoUrl: "https://github.com/alice/notes" },
            "current",
          );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const loaded = await store.loadRememberedSession();
    expect(loaded).toBeNull();

    const otherStore = createSessionStore({ indexedDB, storage });
    const secondLoad = await otherStore.loadRememberedSession();
    expect(secondLoad).toBeNull();
  });

  it("still starts and clears when storage methods throw", async () => {
    const session = await makeSession();
    const store = createSessionStore({
      indexedDB,
      storage: new ThrowingStorage(),
    });

    const result = await store.start(session, { rememberMe: true });
    expect(result.remembered).toBe(true);
    expect(store.current).toEqual(session);
    expect(store.lastRepoUrl()).toBeNull();

    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("still starts and clears when the IDBFactory's open throws", async () => {
    const session = await makeSession();
    const store = createSessionStore({
      indexedDB: new ThrowingIDBFactory() as unknown as IDBFactory,
      storage,
    });

    const result = await store.start(session, { rememberMe: true });
    expect(result).toEqual({ remembered: false });
    expect(store.current).toEqual(session);

    await expect(store.clear()).resolves.toBeUndefined();
  });
});
