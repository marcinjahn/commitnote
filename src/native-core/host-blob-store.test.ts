import { describe, expect, it } from "vitest";
import { describeBlobStoreContract } from "../blob-cache/testing/blob-store-contract";
import { createHostBlobStore } from "./host-blob-store";
import { createNodeHostServices } from "./testing/node-host-services";

describeBlobStoreContract("host blob store", () => {
  const host = createNodeHostServices();
  return (capBytes) => createHostBlobStore(host, { capBytes });
});

describe("host blob store", () => {
  it("stores text as UTF-8 bytes flagged as text and bytes unflagged", async () => {
    const host = createNodeHostServices();
    const store = createHostBlobStore(host);
    await store.put("r", "t", "héllo", 1);
    await store.put("r", "b", new Uint8Array([1, 2]), 2);

    const text = await host.blobCache.get("r", "t");
    expect(text?.text).toBe(true);
    expect(text?.bytes.length).toBe(6);
    expect((await host.blobCache.get("r", "b"))?.text).toBe(false);
    expect((await store.get("r", "b"))?.content).toBeInstanceOf(Uint8Array);
  });

  it("behaves as a miss when the host fails", async () => {
    const host = createNodeHostServices();
    host.blobCache.get = () => Promise.reject(new Error("disk"));
    host.blobCache.put = () => Promise.reject(new Error("disk"));
    const store = createHostBlobStore(host);

    await expect(store.put("r", "a", "x", 1)).resolves.toBeUndefined();
    expect(await store.get("r", "a")).toBeNull();
  });

  it("does nothing after close", async () => {
    const host = createNodeHostServices();
    const store = createHostBlobStore(host);
    store.close();
    await store.put("r", "a", "x", 1);
    expect(await host.blobCache.listRepos()).toEqual([]);
  });

  it("does not relist the whole cache on every put and still evicts least recently used first", async () => {
    const host = createNodeHostServices();
    const calls = { list: 0, listRepos: 0 };
    const inner = host.blobCache;
    const counting = {
      ...inner,
      list: (repoKey: string) => {
        calls.list++;
        return inner.list(repoKey);
      },
      listRepos: () => {
        calls.listRepos++;
        return inner.listRepos();
      },
    };
    const store = createHostBlobStore(
      { ...host, blobCache: counting },
      { capBytes: 100 },
    );

    for (let i = 0; i < 50; i++) {
      await store.put("r", `b${i}`, "x", i + 1);
    }
    expect(calls.listRepos).toBeLessThanOrEqual(1);
    expect(calls.list).toBeLessThanOrEqual(1);

    await store.touch("r", "b0", 1000);
    await store.put("r", "big", "y".repeat(52), 2000);

    expect(await store.get("r", "big")).not.toBeNull();
    expect(await store.get("r", "b0")).not.toBeNull();
    for (let i = 1; i <= 2; i++) expect(await store.get("r", `b${i}`)).toBeNull();
    expect(await store.get("r", "b3")).not.toBeNull();
  });
});
