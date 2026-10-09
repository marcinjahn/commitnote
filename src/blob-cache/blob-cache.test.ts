import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gitBlobSha } from "../forge/git-blob-sha";
import { createTestClock } from "../sync/testing/test-clock";
import { createBlobCache, repoKeyOf } from "./blob-cache";
import { createBlobStore } from "./blob-store";

const REPO = "github:alice/notes";
const OTHER_REPO = "gitlab:bob/other";

describe("repoKeyOf", () => {
  it("joins forge, owner and repo", () => {
    expect(
      repoKeyOf({ forge: "gitlab", owner: "group/sub", repo: "notes" }),
    ).toBe("gitlab:group/sub/notes");
  });
});

describe("blob cache", () => {
  let factory: IDBFactory;
  let clock: ReturnType<typeof createTestClock>;

  beforeAll(() => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
  });

  beforeEach(() => {
    factory = new IDBFactory();
    clock = createTestClock(1000);
  });

  function newCache(repoKey = REPO) {
    const store = createBlobStore({ indexedDB: factory });
    return { store, cache: createBlobCache({ store, repoKey, clock }) };
  }

  it("purges entries that are unreferenced and last used before the snapshot", async () => {
    const { store, cache } = newCache();
    await store.put(REPO, "referenced", "v1:a", 1000);
    await store.put(REPO, "stale", "v1:b", 1000);
    await store.put(REPO, "recent", "v1:c", 3000);
    await store.put(OTHER_REPO, "elsewhere", "v1:d", 1000);

    await cache.purge(new Set(["referenced"]), 2000);

    expect(await store.get(REPO, "referenced")).not.toBeNull();
    expect(await store.get(REPO, "stale")).toBeNull();
    expect(await store.get(REPO, "recent")).not.toBeNull();
    expect(await store.get(OTHER_REPO, "elsewhere")).not.toBeNull();
  });

  it("returns the running purge to a concurrent caller", () => {
    const { cache } = newCache();
    const first = cache.purge(new Set(), 2000);
    expect(cache.purge(new Set(), 2000)).toBe(first);
  });

  it("dispose waits for in-flight fills, including commit fills still hashing", async () => {
    const { cache } = newCache();
    cache.fill("sha-plain", "v1:plain");
    cache.fillCommit([
      { kind: "upsert-text", path: "p", text: "v1:committed" },
    ]);

    await cache.dispose();

    const reopened = newCache().store;
    expect(await reopened.get(REPO, "sha-plain")).toMatchObject({
      text: "v1:plain",
    });
    expect(
      await reopened.get(REPO, await gitBlobSha("v1:committed")),
    ).toMatchObject({
      text: "v1:committed",
    });
  });

  it("ignores fills, reads and purges after dispose", async () => {
    const { cache } = newCache();
    await cache.dispose();

    cache.fill("sha-late", "v1:late");
    cache.fillCommit([
      { kind: "upsert-text", path: "p", text: "v1:late-commit" },
    ]);
    await cache.purge(new Set(), 2000);

    expect(await cache.read("sha-late")).toBeNull();
    const reopened = newCache().store;
    expect(await reopened.get(REPO, "sha-late")).toBeNull();
    expect(
      await reopened.get(REPO, await gitBlobSha("v1:late-commit")),
    ).toBeNull();
  });

  it("dispose returns the same promise on repeated calls", () => {
    const { cache } = newCache();
    expect(cache.dispose()).toBe(cache.dispose());
  });

  it("clear removes this repo's entries, including in-flight fills, and keeps other repos", async () => {
    const { store, cache } = newCache();
    await store.put(REPO, "stored", "v1:stored", 1000);
    await store.put(OTHER_REPO, "elsewhere", "v1:other", 1000);
    cache.fill("in-flight", "v1:in-flight");
    cache.fillCommit([
      { kind: "upsert-text", path: "p", text: "v1:committed" },
    ]);

    await cache.clear();

    const reopened = newCache().store;
    expect(await reopened.get(REPO, "stored")).toBeNull();
    expect(await reopened.get(REPO, "in-flight")).toBeNull();
    expect(
      await reopened.get(REPO, await gitBlobSha("v1:committed")),
    ).toBeNull();
    expect(await reopened.get(OTHER_REPO, "elsewhere")).not.toBeNull();
  });

  it("clear after dispose returns the dispose promise and keeps entries", async () => {
    const { cache } = newCache();
    cache.fill("kept", "v1:kept");

    const disposed = cache.dispose();
    const cleared = cache.clear();

    expect(cleared).toBe(disposed);
    await expect(cleared).resolves.toBeUndefined();
    expect(await newCache().store.get(REPO, "kept")).not.toBeNull();
  });
});
