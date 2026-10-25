import { describe, expect, it } from "vitest";
import { SHARE_FILE, shareImageFileName } from "../share-files";
import { ShareReadError } from "../share-host";
import {
  FAKE_SHARE_STORE_KEY,
  createFakeShareReaders,
  createFakeShareStore,
} from "./fake-share-store";

function sharedStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("fake share store", () => {
  it("lets two stores over the same storage see each other's shares", () => {
    const storage = sharedStorage();
    const first = createFakeShareStore(storage);
    const second = createFakeShareStore(storage);

    const locator = first.create("github", { [SHARE_FILE]: "envelope" });
    expect(second.read(locator)).toEqual({ [SHARE_FILE]: "envelope" });
    expect(second.delete(locator)).toBe(true);
    expect(first.read(locator)).toBeNull();
  });

  it("creates gist locators with hex ids", () => {
    const locator = createFakeShareStore().create("github", { [SHARE_FILE]: "x" });
    if (locator.provider !== "github") throw new Error("expected github");
    expect(locator.gistId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("creates snippet locators with increasing decimal ids from 1000", () => {
    const store = createFakeShareStore();
    expect(store.create("gitlab", { [SHARE_FILE]: "a" })).toEqual({
      provider: "gitlab",
      snippetId: "1000",
    });
    expect(store.create("gitlab", { [SHARE_FILE]: "b" })).toEqual({
      provider: "gitlab",
      snippetId: "1001",
    });
  });

  it("replaces the whole file set on update", () => {
    const store = createFakeShareStore();
    const locator = store.create("github", {
      [SHARE_FILE]: "before",
      [shareImageFileName(0)]: "a",
      [shareImageFileName(1)]: "b",
    });
    expect(store.update(locator, { [SHARE_FILE]: "after" })).toBe(true);
    expect(store.read(locator)).toEqual({ [SHARE_FILE]: "after" });
  });

  it("ignores entries stored in the old string shape", () => {
    const storage = sharedStorage();
    storage.setItem(
      FAKE_SHARE_STORE_KEY,
      JSON.stringify({ nextSnippetId: 1000, shares: { "gl:7": "old" } }),
    );
    const store = createFakeShareStore(storage);
    expect(store.read({ provider: "gitlab", snippetId: "7" })).toBeNull();
  });

  it("reports false when updating a missing share", () => {
    const store = createFakeShareStore();
    const locator = { provider: "gitlab", snippetId: "5" } as const;
    expect(store.update(locator, { [SHARE_FILE]: "x" })).toBe(false);
    expect(store.read(locator)).toBeNull();
  });

  it("reports false when deleting a missing share", () => {
    const store = createFakeShareStore();
    expect(store.delete({ provider: "gitlab", snippetId: "5" })).toBe(false);
  });

  it("makes readers throw notFound for missing shares", async () => {
    const store = createFakeShareStore();
    const readers = createFakeShareReaders(store);
    const locator = store.create("gitlab", { [SHARE_FILE]: "hello" });

    const hosted = await readers.gitlab.read(locator);
    expect(hosted.envelope).toBe("hello");
    store.delete(locator);
    await expect(readers.gitlab.read(locator)).rejects.toBeInstanceOf(
      ShareReadError,
    );
    await expect(readers.github.read(locator)).rejects.toMatchObject({
      kind: "notFound",
    });
  });

  it("reads image files lazily and rejects other files as damaged", async () => {
    const store = createFakeShareStore();
    const readers = createFakeShareReaders(store);
    const locator = store.create("github", {
      [SHARE_FILE]: "env",
      [shareImageFileName(0)]: "img",
    });
    const hosted = await readers.github.read(locator);

    await expect(hosted.readImageFile(shareImageFileName(0))).resolves.toBe(
      "img",
    );
    store.update(locator, {
      [SHARE_FILE]: "env",
      [shareImageFileName(0)]: "img2",
    });
    await expect(hosted.readImageFile(shareImageFileName(0))).resolves.toBe(
      "img2",
    );
    await expect(
      hosted.readImageFile(shareImageFileName(1)),
    ).rejects.toMatchObject({ kind: "damaged" });
    await expect(hosted.readImageFile(SHARE_FILE)).rejects.toMatchObject({
      kind: "damaged",
    });
  });
});
