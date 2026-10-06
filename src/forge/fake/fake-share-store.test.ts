import { describe, expect, it } from "vitest";
import { ShareReadError } from "../share-host";
import { createFakeShareReaders, createFakeShareStore } from "./fake-share-store";

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

    const locator = first.create("github", "envelope");
    expect(second.read(locator)).toBe("envelope");
    expect(second.delete(locator)).toBe(true);
    expect(first.read(locator)).toBeNull();
  });

  it("creates gist locators with hex ids", () => {
    const locator = createFakeShareStore().create("github", "x");
    if (locator.provider !== "github") throw new Error("expected github");
    expect(locator.gistId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("creates snippet locators with increasing decimal ids from 1000", () => {
    const store = createFakeShareStore();
    expect(store.create("gitlab", "a")).toEqual({
      provider: "gitlab",
      snippetId: "1000",
    });
    expect(store.create("gitlab", "b")).toEqual({
      provider: "gitlab",
      snippetId: "1001",
    });
  });

  it("replaces the stored envelope on update", () => {
    const store = createFakeShareStore();
    const locator = store.create("github", "before");
    expect(store.update(locator, "after")).toBe(true);
    expect(store.read(locator)).toBe("after");
  });

  it("reports false when updating a missing share", () => {
    const store = createFakeShareStore();
    const locator = { provider: "gitlab", snippetId: "5" } as const;
    expect(store.update(locator, "x")).toBe(false);
    expect(store.read(locator)).toBeNull();
  });

  it("reports false when deleting a missing share", () => {
    const store = createFakeShareStore();
    expect(store.delete({ provider: "gitlab", snippetId: "5" })).toBe(false);
  });

  it("makes readers throw notFound for missing shares", async () => {
    const store = createFakeShareStore();
    const readers = createFakeShareReaders(store);
    const locator = store.create("gitlab", "hello");

    await expect(readers.gitlab.read(locator)).resolves.toBe("hello");
    store.delete(locator);
    await expect(readers.gitlab.read(locator)).rejects.toBeInstanceOf(
      ShareReadError,
    );
    await expect(readers.github.read(locator)).rejects.toMatchObject({
      kind: "notFound",
    });
  });
});
