import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgeError } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import { FakeForgeAdapter } from "../forge/fake/fake-forge-adapter";
import type {
  CommitRequest,
  CommitResult,
  ForgeAdapter,
} from "../forge/forge-adapter";
import { gitBlobSha } from "../forge/git-blob-sha";
import { createTestClock } from "../sync/testing/test-clock";
import { createBlobCache } from "./blob-cache";
import { createBlobStore } from "./blob-store";
import { withBlobCache } from "./caching-adapter";

const REPO = "github:alice/notes";

class ThrowingIDBFactory {
  open(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }

  deleteDatabase(): IDBOpenDBRequest {
    throw new Error("indexeddb unavailable");
  }
}

function commitRequest(changes: CommitRequest["changes"]): CommitRequest {
  return { parent: "parent", changes, message: "save" };
}

describe("withBlobCache", () => {
  let factory: IDBFactory;
  let blobs: Map<string, string>;
  let readBlobCalls: string[];
  let commitResult: CommitResult | ForgeError;
  let inner: ForgeAdapter;

  beforeAll(() => {
    vi.stubGlobal("IDBKeyRange", FakeIDBKeyRange);
  });

  beforeEach(() => {
    factory = new IDBFactory();
    blobs = new Map();
    readBlobCalls = [];
    commitResult = { kind: "ok", head: "head" };
    inner = delegateAdapter(new FakeForgeAdapter(), {
      readBlob: async (sha) => {
        readBlobCalls.push(sha);
        const text = blobs.get(sha);
        if (text === undefined) throw new ForgeError("NotFound");
        return text;
      },
      commit: async () => {
        if (commitResult instanceof ForgeError) throw commitResult;
        return commitResult;
      },
    });
  });

  function cached(indexedDB: IDBFactory = factory) {
    const store = createBlobStore({ indexedDB });
    const cache = createBlobCache({
      store,
      repoKey: REPO,
      clock: createTestClock(1000),
    });
    return { store, cache, adapter: withBlobCache(inner, cache) };
  }

  it("forwards the inner observed rate limit", () => {
    const limit = { remaining: 7, resetAt: 1234 };
    const { adapter } = cached();
    expect(adapter.observedRateLimit?.()).toBeNull();
    inner = delegateAdapter(new FakeForgeAdapter(), {
      observedRateLimit: () => limit,
    });
    expect(cached().adapter.observedRateLimit?.()).toBe(limit);
  });

  async function addBlob(text: string): Promise<string> {
    const sha = await gitBlobSha(text);
    blobs.set(sha, text);
    return sha;
  }

  it("serves a repeated read from the cache", async () => {
    const sha = await addBlob("v1:note");
    const { adapter } = cached();

    expect(await adapter.readBlob(sha)).toBe("v1:note");
    expect(await adapter.readBlob(sha)).toBe("v1:note");

    expect(readBlobCalls).toEqual([sha]);
  });

  it("serves a read from entries filled by an earlier session", async () => {
    const sha = await addBlob("v1:note");
    const first = cached();
    await first.adapter.readBlob(sha);
    await first.cache.dispose();

    const second = cached();
    expect(await second.adapter.readBlob(sha)).toBe("v1:note");

    expect(readBlobCalls).toEqual([sha]);
  });

  it("propagates inner read errors and fills nothing", async () => {
    const { adapter, cache, store } = cached();

    await expect(adapter.readBlob("missing")).rejects.toMatchObject({
      kind: "NotFound",
    });

    expect(await cache.read("missing")).toBeNull();
    expect(await store.get(REPO, "missing")).toBeNull();
  });

  it("deletes an entry whose text does not hash to its SHA and reads from inner", async () => {
    const sha = await addBlob("v1:real");
    const { adapter, store } = cached();
    await store.put(REPO, sha, "v1:tampered", 1000);
    await store.put(REPO, "wrong-sha", "v1:tampered", 1000);

    expect(await adapter.readBlob(sha)).toBe("v1:real");
    await expect(adapter.readBlob("wrong-sha")).rejects.toBeInstanceOf(
      ForgeError,
    );

    expect(readBlobCalls).toEqual([sha, "wrong-sha"]);
    expect(await store.get(REPO, "wrong-sha")).toBeNull();
  });

  it("fills upsert-text changes of a successful commit, readable immediately", async () => {
    const { adapter, store } = cached();
    const result = await adapter.commit(
      commitRequest([
        { kind: "upsert-text", path: "a", text: "v1:committed" },
        { kind: "upsert-blob", path: "b", blobSha: "kept-sha" },
        { kind: "delete", path: "c" },
      ]),
    );

    expect(result).toEqual({ kind: "ok", head: "head" });
    const sha = await gitBlobSha("v1:committed");
    expect(await adapter.readBlob(sha)).toBe("v1:committed");
    expect(readBlobCalls).toEqual([]);
    await expect(adapter.readBlob("kept-sha")).rejects.toBeInstanceOf(
      ForgeError,
    );
    expect(await store.get(REPO, sha)).toMatchObject({ text: "v1:committed" });
  });

  it("fills nothing for stale or rejected commits", async () => {
    const { adapter, cache } = cached();
    const changes = [
      { kind: "upsert-text", path: "a", text: "v1:lost" },
    ] as const;

    commitResult = { kind: "stale" };
    expect(await adapter.commit(commitRequest(changes))).toEqual({
      kind: "stale",
    });
    commitResult = new ForgeError("Network");
    await expect(adapter.commit(commitRequest(changes))).rejects.toBe(
      commitResult,
    );

    expect(await cache.read(await gitBlobSha("v1:lost"))).toBeNull();
  });

  it("exposes optional members only when inner has them, calling inner", async () => {
    const bare = cached().adapter;
    for (const member of [
      "atomicCommitSupport",
      "enableAtomicCommits",
      "replaceHistory",
      "sweepAbandoned",
    ] as const) {
      expect(member in bare).toBe(false);
      expect(bare[member]).toBeUndefined();
    }

    const support = { kind: "available" } as const;
    const atomicCommitSupport = vi.fn(async () => support);
    const enableAtomicCommits = vi.fn(async () => support);
    const replaceHistory = vi.fn(async () => ({ kind: "stale" }) as const);
    const sweepAbandoned = vi.fn(async () => undefined);
    inner = delegateAdapter(inner, {
      atomicCommitSupport,
      enableAtomicCommits,
      replaceHistory,
      sweepAbandoned,
    });
    const full = cached().adapter;

    expect(await full.atomicCommitSupport?.()).toBe(support);
    expect(await full.enableAtomicCommits?.()).toBe(support);
    expect(await full.replaceHistory?.({ head: "h", message: "m" })).toEqual({
      kind: "stale",
    });
    await full.sweepAbandoned?.();
    expect(atomicCommitSupport).toHaveBeenCalledOnce();
    expect(enableAtomicCommits).toHaveBeenCalledOnce();
    expect(replaceHistory).toHaveBeenCalledWith({ head: "h", message: "m" });
    expect(sweepAbandoned).toHaveBeenCalledOnce();
  });

  it("falls through to inner without rejecting when IndexedDB cannot open", async () => {
    const sha = await addBlob("v1:note");
    const { adapter, cache } = cached(
      new ThrowingIDBFactory() as unknown as IDBFactory,
    );

    expect(await adapter.readBlob(sha)).toBe("v1:note");
    await adapter.commit(
      commitRequest([{ kind: "upsert-text", path: "a", text: "v1:x" }]),
    );
    await cache.purge(new Set(), 2000);
    await cache.clear();
    expect(await adapter.readBlob(sha)).toBe("v1:note");

    expect(readBlobCalls).toEqual([sha, sha]);
  });
});
