import type { BlobStore, BlobStoreEntry } from "../blob-store";

export interface MemoryBlobStoreProvider {
  open(): BlobStore;
  deleteAll(): Promise<void>;
  readonly entries: Map<string, BlobStoreEntry>;
  readonly opened: number;
  readonly deletedAll: number;
}

function keyOf(repoKey: string, blobSha: string): string {
  return `${repoKey}\u0000${blobSha}`;
}

function repoOf(key: string): string {
  return key.slice(0, key.indexOf("\u0000"));
}

function shaOf(key: string): string {
  return key.slice(key.indexOf("\u0000") + 1);
}

export function createMemoryBlobStoreProvider(): MemoryBlobStoreProvider {
  const entries = new Map<string, BlobStoreEntry>();
  let opened = 0;
  let deletedAll = 0;

  function deleteWhere(predicate: (key: string) => boolean): Promise<void> {
    for (const key of [...entries.keys()]) {
      if (predicate(key)) entries.delete(key);
    }
    return Promise.resolve();
  }

  const store: BlobStore = {
    get: (repoKey, blobSha) => Promise.resolve(entries.get(keyOf(repoKey, blobSha)) ?? null),
    touch(repoKey, blobSha, lastUsedAt) {
      const entry = entries.get(keyOf(repoKey, blobSha));
      if (entry !== undefined) entries.set(keyOf(repoKey, blobSha), { ...entry, lastUsedAt });
      return Promise.resolve();
    },
    put(repoKey, blobSha, content, lastUsedAt) {
      const size = typeof content === "string" ? content.length : content.byteLength;
      entries.set(keyOf(repoKey, blobSha), { content, size, lastUsedAt });
      return Promise.resolve();
    },
    delete: (repoKey, blobSha) => deleteWhere((key) => key === keyOf(repoKey, blobSha)),
    deleteUnreferenced: (repoKey, referenced, before) =>
      deleteWhere(
        (key) =>
          repoOf(key) === repoKey &&
          !referenced.has(shaOf(key)) &&
          (entries.get(key)?.lastUsedAt ?? 0) < before,
      ),
    deleteRepo: (repoKey) => deleteWhere((key) => repoOf(key) === repoKey),
    deleteOtherRepos: (repoKey) => deleteWhere((key) => repoOf(key) !== repoKey),
    close: () => undefined,
  };

  return {
    open() {
      opened++;
      return store;
    },
    deleteAll() {
      deletedAll++;
      entries.clear();
      return Promise.resolve();
    },
    entries,
    get opened() {
      return opened;
    },
    get deletedAll() {
      return deletedAll;
    },
  };
}
