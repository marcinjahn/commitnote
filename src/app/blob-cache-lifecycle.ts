import {
  createBlobCache,
  repoKeyOf,
  type BlobCache,
} from "../blob-cache/blob-cache";
import {
  createBlobStore,
  deleteBlobCacheDatabase,
  type BlobStore,
} from "../blob-cache/blob-store";
import type { RepoCoordinates } from "../forge/repo-coordinates";
import type { ContentIndexer } from "../search/content-indexer";
import type { Clock } from "../sync/clock";
import type { SyncEngine } from "../sync/sync-engine";

export interface BlobStoreProvider {
  open(): BlobStore;
  deleteAll(): Promise<void>;
}

export function indexedDBBlobStoreProvider(indexedDB?: IDBFactory): BlobStoreProvider {
  return {
    open: () => createBlobStore(indexedDB === undefined ? undefined : { indexedDB }),
    deleteAll: () => deleteBlobCacheDatabase(indexedDB),
  };
}

export async function openSessionBlobCache(options: {
  readonly remembered: boolean;
  readonly coordinates: RepoCoordinates;
  readonly clock: Pick<Clock, "now">;
  readonly indexedDB?: IDBFactory;
  readonly blobStore?: BlobStoreProvider;
}): Promise<BlobCache | null> {
  const provider = options.blobStore ?? indexedDBBlobStoreProvider(options.indexedDB);
  if (!options.remembered) {
    await provider.deleteAll();
    return null;
  }
  const store = provider.open();
  const repoKey = repoKeyOf(options.coordinates);
  void store.deleteOtherRepos(repoKey).catch(() => undefined);
  return createBlobCache({ store, repoKey, clock: options.clock });
}

export function purgeBlobCacheNow(options: {
  readonly engine: Pick<SyncEngine, "referencedBlobShas">;
  readonly cache: Pick<BlobCache, "purge">;
  readonly clock: Pick<Clock, "now">;
}): void {
  const referenced = options.engine.referencedBlobShas();
  if (referenced === null) return;
  void options.cache
    .purge(referenced, options.clock.now())
    .catch(() => undefined);
}

export function purgeBlobCacheWhenIndexed(options: {
  readonly indexer: Pick<ContentIndexer, "getState" | "subscribe">;
  readonly engine: Pick<SyncEngine, "referencedBlobShas">;
  readonly cache: Pick<BlobCache, "purge">;
  readonly clock: Pick<Clock, "now">;
}): () => void {
  const { indexer } = options;
  let previous = indexer.getState().status.kind;
  return indexer.subscribe(() => {
    const current = indexer.getState().status.kind;
    const entered = current === "complete" && previous !== "complete";
    previous = current;
    if (entered) purgeBlobCacheNow(options);
  });
}
