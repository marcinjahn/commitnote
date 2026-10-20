import { beforeEach, describe, expect, it } from "vitest";
import type { BlobStore } from "../blob-store";

const REPO = "github:alice/notes";
const OTHER_REPO = "gitlab:bob/other";

export type BlobStoreFactory = (capBytes?: number) => BlobStore;

export function describeBlobStoreContract(
  name: string,
  setup: () => BlobStoreFactory,
): void {
  describe(`${name} (shared store behaviour)`, () => {
    let create: BlobStoreFactory;

    beforeEach(() => {
      create = setup();
    });

    it("round-trips text with its UTF-8 size", async () => {
      const store = create();
      await store.put(REPO, "sha1", "v1:héllo", 1000);

      expect(await store.get(REPO, "sha1")).toEqual({
        content: "v1:héllo",
        size: 9,
        lastUsedAt: 1000,
      });
      store.close();
    });

  it("returns null for a missing entry and does not touch on get", async () => {
    const store = create();
    expect(await store.get(REPO, "missing")).toBeNull();
    await store.put(REPO, "a", "v1:a", 5);
    await store.get(REPO, "a");
    expect((await store.get(REPO, "a"))?.lastUsedAt).toBe(5);
    store.close();
  });

  it("touch rewrites lastUsedAt of an existing entry only", async () => {
    const store = create();
    await store.put(REPO, "a", "v1:a", 5);
    await store.touch(REPO, "a", 99);
    await store.touch(REPO, "absent", 99);

    expect(await store.get(REPO, "a")).toEqual({
      content: "v1:a",
      size: 4,
      lastUsedAt: 99,
    });
    expect(await store.get(REPO, "absent")).toBeNull();
    store.close();
  });

  it("isolates entries by repoKey", async () => {
    const store = create();
    await store.put(REPO, "same", "v1:one", 1);
    await store.put(OTHER_REPO, "same", "v1:two", 2);

    expect((await store.get(REPO, "same"))?.content).toBe("v1:one");
    expect((await store.get(OTHER_REPO, "same"))?.content).toBe("v1:two");
    await store.delete(REPO, "same");
    expect(await store.get(REPO, "same")).toBeNull();
    expect((await store.get(OTHER_REPO, "same"))?.content).toBe("v1:two");
    store.close();
  });

  it("round-trips bytes and sizes them by byte length", async () => {
    const store = create();
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await store.put(REPO, "img", bytes, 7);

    const entry = await store.get(REPO, "img");
    expect(entry?.size).toBe(4);
    expect(entry?.content).toBeInstanceOf(Uint8Array);
    expect([...(entry?.content as Uint8Array)]).toEqual([0, 1, 2, 255]);
    store.close();
  });

  describe("LRU eviction", () => {
    it("counts byte sizes when evicting", async () => {
      const store = create(10);
      await store.put(REPO, "old", new Uint8Array(6), 10);
      await store.put(REPO, "new", new Uint8Array(6), 20);

      expect(await store.get(REPO, "old")).toBeNull();
      expect(await store.get(REPO, "new")).not.toBeNull();
      store.close();
    });

    it("evicts the oldest lastUsedAt first and keeps the new entry", async () => {
      const store = create(10);
      await store.put(REPO, "old", "1234", 10);
      await store.put(OTHER_REPO, "mid", "1234", 20);
      await store.put(REPO, "new", "123456", 30);

      expect(await store.get(REPO, "old")).toBeNull();
      expect(await store.get(OTHER_REPO, "mid")).not.toBeNull();
      expect(await store.get(REPO, "new")).not.toBeNull();

      await store.put(REPO, "newest", "1234", 40);
      expect(await store.get(OTHER_REPO, "mid")).toBeNull();
      expect(await store.get(REPO, "new")).not.toBeNull();
      expect(await store.get(REPO, "newest")).not.toBeNull();
      store.close();
    });

    it("respects touch when choosing the victim", async () => {
      const store = create(8);
      await store.put(REPO, "a", "1234", 10);
      await store.put(REPO, "b", "1234", 20);
      await store.touch(REPO, "a", 30);
      await store.put(REPO, "c", "1234", 40);

      expect(await store.get(REPO, "b")).toBeNull();
      expect(await store.get(REPO, "a")).not.toBeNull();
      store.close();
    });

    it("skips an entry larger than the cap", async () => {
      const store = create(5);
      await store.put(REPO, "small", "123", 1);
      await store.put(REPO, "huge", "123456", 2);

      expect(await store.get(REPO, "huge")).toBeNull();
      expect(await store.get(REPO, "small")).not.toBeNull();
      store.close();
    });

    it("does not double-count an overwrite", async () => {
      const store = create(10);
      await store.put(REPO, "a", "123456", 1);
      await store.put(REPO, "a", "654321", 2);
      await store.put(REPO, "b", "1234", 3);

      expect(await store.get(REPO, "a")).toEqual({
        content: "654321",
        size: 6,
        lastUsedAt: 2,
      });
      expect(await store.get(REPO, "b")).not.toBeNull();
      store.close();
    });

    it("sums existing entries when a new instance starts", async () => {
      const first = create(10);
      await first.put(REPO, "a", "123456", 1);
      first.close();

      const second = create(10);
      await second.put(REPO, "b", "123456", 2);
      expect(await second.get(REPO, "a")).toBeNull();
      expect(await second.get(REPO, "b")).not.toBeNull();
      second.close();
    });

    it("keeps accounting correct after deletes", async () => {
      const store = create(10);
      await store.put(REPO, "a", "123456", 1);
      await store.delete(REPO, "a");
      await store.put(REPO, "b", "123456", 2);
      await store.put(REPO, "c", "1234", 3);

      expect(await store.get(REPO, "b")).not.toBeNull();
      expect(await store.get(REPO, "c")).not.toBeNull();
      store.close();
    });
  });

  describe("bulk deletions", () => {
    it("deleteUnreferenced keeps referenced, recent and other-repo entries", async () => {
      const store = create();
      await store.put(REPO, "referenced", "v1:a", 1);
      await store.put(REPO, "stale", "v1:b", 2);
      await store.put(REPO, "recent", "v1:c", 100);
      await store.put(OTHER_REPO, "stale", "v1:d", 2);
      await store.put("github:alice/notes2", "stale", "v1:e", 2);

      await store.deleteUnreferenced(REPO, new Set(["referenced"]), 100);

      expect(await store.get(REPO, "referenced")).not.toBeNull();
      expect(await store.get(REPO, "stale")).toBeNull();
      expect(await store.get(REPO, "recent")).not.toBeNull();
      expect(await store.get(OTHER_REPO, "stale")).not.toBeNull();
      expect(await store.get("github:alice/notes2", "stale")).not.toBeNull();
      store.close();
    });

    it("deleteRepo removes only that repo", async () => {
      const store = create();
      await store.put(REPO, "a", "v1:a", 1);
      await store.put(REPO, "b", "v1:b", 2);
      await store.put(OTHER_REPO, "a", "v1:c", 3);
      await store.put("github:alice/notes2", "a", "v1:d", 3);

      await store.deleteRepo(REPO);

      expect(await store.get(REPO, "a")).toBeNull();
      expect(await store.get(REPO, "b")).toBeNull();
      expect(await store.get(OTHER_REPO, "a")).not.toBeNull();
      expect(await store.get("github:alice/notes2", "a")).not.toBeNull();
      store.close();
    });

    it("deleteOtherRepos keeps only that repo", async () => {
      const store = create();
      await store.put("github:alice/aaa", "a", "v1:a", 1);
      await store.put(REPO, "a", "v1:b", 2);
      await store.put("github:alice/notes2", "a", "v1:c", 3);
      await store.put(OTHER_REPO, "a", "v1:d", 4);

      await store.deleteOtherRepos(REPO);

      expect(await store.get(REPO, "a")).not.toBeNull();
      expect(await store.get("github:alice/aaa", "a")).toBeNull();
      expect(await store.get("github:alice/notes2", "a")).toBeNull();
      expect(await store.get(OTHER_REPO, "a")).toBeNull();
      store.close();
    });
  });
  });
}
