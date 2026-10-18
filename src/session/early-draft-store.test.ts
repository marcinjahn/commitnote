import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { EarlyDraft } from "../app/early-draft";
import type { ImagePayload } from "../crypto/image-cipher";
import { createPendingImage } from "../images/pending-image";
import { testKeyring } from "../crypto/testing/test-keyring";
import {
  createEarlyDraftStore,
  deleteEarlyDraftDatabase,
  EARLY_DRAFT_DB_NAME,
} from "./early-draft-store";

const PAYLOADS: ImagePayload[] = [
  {
    type: "image/webp",
    width: 320,
    height: 200,
    bytes: Uint8Array.from({ length: 300 }, (_, i) => (i * 13) & 0xff),
  },
  {
    type: "image/gif",
    width: 64,
    height: 48,
    bytes: Uint8Array.from({ length: 120 }, (_, i) => (i * 7) & 0xff),
  },
];

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

function writeRaw(
  factory: IDBFactory,
  key: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = factory.open(EARLY_DRAFT_DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(value, key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
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

    expect(await store.load(REPO_KEY, keyring)).toEqual({ draft: DRAFT, images: [] });
  });

  it("round trips pending images", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    const images = [
      await createPendingImage(keyring, PAYLOADS[0]),
      await createPendingImage(keyring, PAYLOADS[1]),
    ];

    await store.save(REPO_KEY, keyring, DRAFT, images);

    expect(await store.load(REPO_KEY, keyring)).toEqual({
      draft: DRAFT,
      images,
    });
  });

  it("skips an image whose envelope was tampered with", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    const good = await createPendingImage(keyring, PAYLOADS[0]);
    const bad = await createPendingImage(keyring, PAYLOADS[1]);
    const tampered = bad.envelope.slice();
    tampered[tampered.length - 1] ^= 0xff;

    await store.save(REPO_KEY, keyring, DRAFT, [
      { ...bad, envelope: tampered },
      good,
    ]);

    expect(await store.load(REPO_KEY, keyring)).toEqual({
      draft: DRAFT,
      images: [good],
    });
  });

  it("loads a record without images as having none", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    await store.save(REPO_KEY, keyring, DRAFT);
    const raw = (await readRaw(factory, REPO_KEY)) as Record<string, unknown>;
    delete raw.images;
    await writeRaw(factory, REPO_KEY, raw);

    expect(await store.load(REPO_KEY, keyring)).toEqual({
      draft: DRAFT,
      images: [],
    });
  });

  it("removes images with the draft and with the database", async () => {
    const keyring = await testKeyring();
    const store = createEarlyDraftStore({ indexedDB: factory });
    const images = [await createPendingImage(keyring, PAYLOADS[0])];
    await store.save(REPO_KEY, keyring, DRAFT, images);

    await store.remove(REPO_KEY);
    expect(await readRaw(factory, REPO_KEY)).toBeUndefined();

    await store.save(REPO_KEY, keyring, DRAFT, images);
    await deleteEarlyDraftDatabase(factory);
    const names = (await factory.databases()).map((db) => db.name);
    expect(names).not.toContain(EARLY_DRAFT_DB_NAME);
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
    expect(Object.keys(raw as object).sort()).toEqual(["ciphertext", "images", "savedAt"]);
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

    expect((await store.load(REPO_KEY, keyring))?.draft).toEqual(DRAFT);
    expect((await store.load("github:octo/other", keyring))?.draft).toEqual(
      second,
    );
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
