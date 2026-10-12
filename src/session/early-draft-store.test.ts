import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { EarlyDraft } from "../app/early-draft";
import { testKeyring } from "../crypto/testing/test-keyring";
import {
  createEarlyDraftStore,
  deleteEarlyDraftDatabase,
  EARLY_DRAFT_DB_NAME,
} from "./early-draft-store";

const REPO_KEY = "github:octo/notes";

const DRAFT: EarlyDraft = {
  name: "Secret meeting name",
  body: "Confidential body text",
  focus: "body",
  selection: { anchor: 3, head: 5 },
  nameConfirmed: true,
  contentStartedAt: 1_700_000_000_000,
};

function readRaw(factory: IDBFactory, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = factory.open(EARLY_DRAFT_DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("drafts", "readonly").objectStore("drafts").get(key);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    };
  });
}

describe("early draft store", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("round trips a draft", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });

    await store.save(REPO_KEY, keyring, DRAFT);

    expect(await store.load(REPO_KEY, keyring)).toEqual(DRAFT);
  });

  it("returns null when nothing is stored", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });

    expect(await store.load(REPO_KEY, keyring)).toBeNull();
  });

  it("stores no plaintext", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });

    await store.save(REPO_KEY, keyring, DRAFT);

    const raw = await readRaw(factory, REPO_KEY);
    expect(Object.keys(raw as object).sort()).toEqual(["ciphertext", "savedAt"]);
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain(DRAFT.name);
    expect(serialized).not.toContain(DRAFT.body);
  });

  it("deletes the record when another keyring cannot read it", async () => {
    const keyring = await testKeyring();
    const other = await testKeyring("another passphrase", 9);
    const store = createEarlyDraftStore({ indexedDB: factory });
    await store.save(REPO_KEY, keyring, DRAFT);

    expect(await store.load(REPO_KEY, other)).toBeNull();

    expect(await readRaw(factory, REPO_KEY)).toBeUndefined();
    expect(await store.load(REPO_KEY, keyring)).toBeNull();
  });

  it("keeps one draft per repository", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    const second = { ...DRAFT, name: "Other" };

    await store.save(REPO_KEY, keyring, DRAFT);
    await store.save("github:octo/other", keyring, second);

    expect(await store.load(REPO_KEY, keyring)).toEqual(DRAFT);
    expect(await store.load("github:octo/other", keyring)).toEqual(second);
  });

  it("removes a draft", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    await store.save(REPO_KEY, keyring, DRAFT);

    await store.remove(REPO_KEY);

    expect(await store.load(REPO_KEY, keyring)).toBeNull();
  });

  it("deletes the database", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    await store.save(REPO_KEY, keyring, DRAFT);

    await deleteEarlyDraftDatabase(factory);

    const names = (await factory.databases()).map((db) => db.name);
    expect(names).not.toContain(EARLY_DRAFT_DB_NAME);
  });

  it("resolves without throwing when IndexedDB is unavailable", async () => {
    const keyring = await testKeyring();
    const broken = {
      open() {
        throw new Error("unavailable");
      },
      deleteDatabase() {
        throw new Error("unavailable");
      },
    } as unknown as IDBFactory;
    const store = createEarlyDraftStore({ indexedDB: broken });

    await store.save(REPO_KEY, keyring, DRAFT);
    expect(await store.load(REPO_KEY, keyring)).toBeNull();
    await store.remove(REPO_KEY);
    await deleteEarlyDraftDatabase(broken);
  });
});
