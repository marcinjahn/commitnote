import type { TreeEntry } from "../forge/forge-adapter";
import { gitBlobSha } from "../forge/git-blob-sha";
import type { StorageLike } from "../session/session-store";
import type { BlobCache } from "./blob-cache";

/** The last tree loaded from the forge, kept so a remembered session can show it before the forge answers. */
export interface CachedTree {
  readonly head: string;
  readonly listing: readonly TreeEntry[];
}

export interface CachedTreeStore {
  load(): Promise<CachedTree | null>;
  /** Stops before pointing the next start at the tree once `cancelled` returns true. */
  save(tree: CachedTree, cancelled?: () => boolean): Promise<void>;
}

const POINTER_VERSION = 1;
const TREE_VERSION = 1;

type StoredEntry = readonly [type: "b" | "t", sha: string, path: string];

interface StoredTree {
  readonly version: typeof TREE_VERSION;
  readonly head: string;
  readonly entries: readonly StoredEntry[];
}

export function cachedTreeStorageKey(repoKey: string): string {
  return `commitnote.cachedTree.${repoKey}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPointer(storage: StorageLike, key: string): string | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.version !== POINTER_VERSION) return null;
    return typeof value.blobSha === "string" ? value.blobSha : null;
  } catch {
    return null;
  }
}

function isStoredEntry(value: unknown): value is StoredEntry {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    (value[0] === "b" || value[0] === "t") &&
    typeof value[1] === "string" &&
    typeof value[2] === "string"
  );
}

function decodeTree(text: string): CachedTree | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.version !== TREE_VERSION || typeof value.head !== "string") {
      return null;
    }
    if (!Array.isArray(value.entries)) return null;
    const listing: TreeEntry[] = [];
    for (const entry of value.entries) {
      if (!isStoredEntry(entry)) return null;
      const [type, sha, path] = entry;
      listing.push({ type: type === "t" ? "tree" : "blob", sha, path });
    }
    return { head: value.head, listing };
  } catch {
    return null;
  }
}

function encodeTree(tree: CachedTree): string {
  const stored: StoredTree = {
    version: TREE_VERSION,
    head: tree.head,
    entries: tree.listing.map((entry) => [
      entry.type === "tree" ? "t" : "b",
      entry.sha,
      entry.path,
    ]),
  };
  return JSON.stringify(stored);
}

/**
 * Keeps the tree listing as a content-addressed blob in the blob cache, and a
 * small pointer to it in device storage.
 */
export function createCachedTreeStore(options: {
  readonly cache: Pick<BlobCache, "read" | "keep" | "retain">;
  readonly repoKey: string;
  readonly storage?: StorageLike | null;
}): CachedTreeStore {
  const { cache } = options;
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const key = cachedTreeStorageKey(options.repoKey);

  return {
    async load() {
      if (storage === null) return null;
      const blobSha = readPointer(storage, key);
      if (blobSha === null) return null;
      const text = await cache.read(blobSha);
      if (text === null) return null;
      const tree = decodeTree(text);
      if (tree !== null) cache.retain(blobSha);
      return tree;
    },

    async save(tree, cancelled = () => false) {
      if (storage === null) return;
      const text = encodeTree(tree);
      const blobSha = await gitBlobSha(text);
      if (cancelled()) return;
      const kept = await cache.keep(blobSha, text);
      if (!kept || cancelled()) return;
      try {
        storage.setItem(
          key,
          JSON.stringify({ version: POINTER_VERSION, blobSha }),
        );
      } catch {
        // Without the pointer the next start loads from the forge.
      }
    },
  };
}

/** Whether a tree may be cached for the repo, without reading it. */
export function hasCachedTree(
  repoKey: string,
  storage?: StorageLike | null,
): boolean {
  const resolved = storage === undefined ? defaultStorage() : storage;
  return (
    resolved !== null &&
    readPointer(resolved, cachedTreeStorageKey(repoKey)) !== null
  );
}

export function removeCachedTree(
  repoKey: string,
  storage?: StorageLike | null,
): void {
  const resolved = storage === undefined ? defaultStorage() : storage;
  try {
    resolved?.removeItem(cachedTreeStorageKey(repoKey));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
