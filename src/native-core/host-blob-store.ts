import {
  BLOB_CACHE_CAP_BYTES,
  type BlobStore,
  type BlobStoreEntry,
} from "../blob-cache/blob-store";
import type { HostServices } from "./host-services";

interface Listed {
  readonly repoKey: string;
  readonly blobSha: string;
  readonly size: number;
  readonly lastUsedAt: number;
}

function compareLru(a: Listed, b: Listed): number {
  if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt - b.lastUsedAt;
  if (a.repoKey !== b.repoKey) return a.repoKey < b.repoKey ? -1 : 1;
  if (a.blobSha !== b.blobSha) return a.blobSha < b.blobSha ? -1 : 1;
  return 0;
}

export function createHostBlobStore(
  host: HostServices,
  options?: { readonly capBytes?: number },
): BlobStore {
  const capBytes = options?.capBytes ?? BLOB_CACHE_CAP_BYTES;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const cache = host.blobCache;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let total: number | null = null;
  const sizes = new Map<string, number>();

  function entryKey(repoKey: string, blobSha: string): string {
    return `${repoKey}\n${blobSha}`;
  }

  function resetTracking(): void {
    total = null;
    sizes.clear();
  }

  function forget(repoKey: string, blobSha: string): void {
    if (total === null) return;
    const key = entryKey(repoKey, blobSha);
    const size = sizes.get(key);
    if (size === undefined) return;
    sizes.delete(key);
    total -= size;
  }

  function forgetRepo(repoKey: string): void {
    if (total === null) return;
    const prefix = `${repoKey}\n`;
    for (const [key, size] of sizes) {
      if (!key.startsWith(prefix)) continue;
      sizes.delete(key);
      total -= size;
    }
  }

  async function ensureTotal(): Promise<number> {
    if (total !== null) return total;
    let sum = 0;
    const known = new Map<string, number>();
    for (const item of await listAll()) {
      known.set(entryKey(item.repoKey, item.blobSha), item.size);
      sum += item.size;
    }
    sizes.clear();
    for (const [key, size] of known) sizes.set(key, size);
    total = sum;
    return sum;
  }

  function enqueue<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    const guarded = async () => {
      if (closed) return fallback;
      try {
        return await operation();
      } catch {
        resetTracking();
        return fallback;
      }
    };
    const next = queue.then(guarded, guarded);
    queue = next;
    return next;
  }

  async function listAll(): Promise<Listed[]> {
    const all: Listed[] = [];
    for (const repoKey of await cache.listRepos()) {
      for (const item of await cache.list(repoKey)) {
        all.push({ repoKey, ...item });
      }
    }
    return all;
  }

  return {
    get(repoKey, blobSha) {
      return enqueue<BlobStoreEntry | null>(async () => {
        const entry = await cache.get(repoKey, blobSha);
        if (entry === null) return null;
        return {
          content: entry.text ? decoder.decode(entry.bytes) : entry.bytes,
          size: entry.bytes.byteLength,
          lastUsedAt: entry.lastUsedAt,
        };
      }, null);
    },

    touch(repoKey, blobSha, lastUsedAt) {
      return enqueue(() => cache.touch(repoKey, blobSha, lastUsedAt), undefined);
    },

    put(repoKey, blobSha, content, lastUsedAt) {
      return enqueue(async () => {
        const text = typeof content === "string";
        const bytes = text ? encoder.encode(content) : content;
        const size = bytes.byteLength;
        if (size > capBytes) return;

        const key = entryKey(repoKey, blobSha);
        await ensureTotal();
        let projected = (total ?? 0) - (sizes.get(key) ?? 0);
        if (projected + size > capBytes) {
          const others = (await listAll()).filter(
            (item) => !(item.repoKey === repoKey && item.blobSha === blobSha),
          );
          others.sort(compareLru);
          for (const victim of others) {
            if (projected + size <= capBytes) break;
            await cache.delete(victim.repoKey, victim.blobSha);
            projected -= victim.size;
            forget(victim.repoKey, victim.blobSha);
          }
        }
        await cache.put(repoKey, blobSha, { bytes, text, lastUsedAt });
        sizes.set(key, size);
        total = projected + size;
      }, undefined);
    },

    delete(repoKey, blobSha) {
      return enqueue(async () => {
        await cache.delete(repoKey, blobSha);
        forget(repoKey, blobSha);
      }, undefined);
    },

    deleteUnreferenced(repoKey, referenced, before) {
      return enqueue(async () => {
        for (const item of await cache.list(repoKey)) {
          if (!referenced.has(item.blobSha) && item.lastUsedAt < before) {
            await cache.delete(repoKey, item.blobSha);
            forget(repoKey, item.blobSha);
          }
        }
      }, undefined);
    },

    deleteRepo(repoKey) {
      return enqueue(async () => {
        await cache.deleteRepo(repoKey);
        forgetRepo(repoKey);
      }, undefined);
    },

    deleteOtherRepos(repoKey) {
      return enqueue(async () => {
        for (const other of await cache.listRepos()) {
          if (other === repoKey) continue;
          await cache.deleteRepo(other);
          forgetRepo(other);
        }
      }, undefined);
    },

    close() {
      closed = true;
    },
  };
}
