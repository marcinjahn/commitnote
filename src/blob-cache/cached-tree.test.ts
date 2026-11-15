import { describe, expect, it } from "vitest";
import type { TreeEntry } from "../forge/forge-adapter";
import type { StorageLike } from "../session/session-store";
import { createTestClock } from "../sync/testing/test-clock";
import { createBlobCache } from "./blob-cache";
import {
  cachedTreeStorageKey,
  createCachedTreeStore,
  hasCachedTree,
  removeCachedTree,
} from "./cached-tree";
import { createMemoryBlobStoreProvider } from "./testing/memory-blob-store";

const REPO = "github:alice/notes";

const LISTING: readonly TreeEntry[] = [
  { type: "tree", sha: "a".repeat(40), path: "notes" },
  { type: "blob", sha: "b".repeat(40), path: "notes/n1.md.enc" },
];

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function setup() {
  const provider = createMemoryBlobStoreProvider();
  const storage = new MemoryStorage();
  const open = () => {
    const cache = createBlobCache({
      store: provider.open(),
      repoKey: REPO,
      clock: createTestClock(1000),
    });
    return {
      cache,
      store: createCachedTreeStore({ cache, repoKey: REPO, storage }),
    };
  };
  return { provider, storage, open };
}

describe("cached tree store", () => {
  it("loads the saved tree in a later session", async () => {
    const { open } = setup();
    const first = open();
    await first.store.save({ head: "c1", listing: LISTING });
    await first.cache.dispose();

    expect(await open().store.load()).toEqual({ head: "c1", listing: LISTING });
  });

  it("loads nothing without a pointer", async () => {
    expect(await setup().open().store.load()).toBeNull();
  });

  it("loads nothing when the snapshot blob is gone", async () => {
    const { open, provider } = setup();
    const first = open();
    await first.store.save({ head: "c1", listing: LISTING });
    await first.cache.dispose();
    await provider.deleteAll();

    expect(await open().store.load()).toBeNull();
  });

  it("loads nothing for an unreadable pointer", async () => {
    const { open, storage } = setup();
    storage.setItem(cachedTreeStorageKey(REPO), "{not json");

    expect(await open().store.load()).toBeNull();
  });

  it("keeps the loaded snapshot through a purge", async () => {
    const { open } = setup();
    const first = open();
    await first.store.save({ head: "c1", listing: LISTING });
    await first.cache.dispose();

    const second = open();
    await second.store.load();
    await second.cache.purge(new Set(), Number.MAX_SAFE_INTEGER);
    await second.cache.dispose();

    expect(await open().store.load()).not.toBeNull();
  });

  it("points at nothing when the save is cancelled", async () => {
    const { open } = setup();
    const first = open();
    let cancelled = false;
    const saving = first.store.save(
      { head: "c1", listing: LISTING },
      () => cancelled,
    );
    cancelled = true;
    await saving;
    await first.cache.dispose();

    expect(await open().store.load()).toBeNull();
  });

  it("points at nothing when the cache could not store the tree", async () => {
    const { open } = setup();
    const first = open();
    await first.cache.dispose();
    await first.store.save({ head: "c1", listing: LISTING });

    expect(await open().store.load()).toBeNull();
  });

  it("keeps only the latest snapshot", async () => {
    const { open, provider } = setup();
    const first = open();
    await first.store.save({ head: "c1", listing: LISTING });
    await first.store.save({ head: "c2", listing: LISTING });
    await first.cache.dispose();

    expect(await open().store.load()).toEqual({ head: "c2", listing: LISTING });
    expect(provider.entries.size).toBe(1);
  });

  it("tells whether a tree may be cached without reading it", async () => {
    const { open, storage } = setup();
    expect(hasCachedTree(REPO, storage)).toBe(false);

    await open().store.save({ head: "c1", listing: LISTING });

    expect(hasCachedTree(REPO, storage)).toBe(true);
    expect(hasCachedTree("github:alice/other", storage)).toBe(false);
  });

  it("forgets the snapshot once removed", async () => {
    const { open, storage } = setup();
    const first = open();
    await first.store.save({ head: "c1", listing: LISTING });
    await first.cache.dispose();

    removeCachedTree(REPO, storage);

    expect(await open().store.load()).toBeNull();
  });
});
