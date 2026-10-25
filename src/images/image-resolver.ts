import { decryptImage, type ImagePayload } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import type { ForgeAdapter } from "../forge/forge-adapter";
import type { SyncEngine } from "../sync/sync-engine";
import { type ImageId, isImageId } from "./image-id";
import type { ImageSource, ImageSourceResult } from "./image-source";

export interface ImageResolverDeps {
  readonly keyring: Keyring;
  readonly adapter: Pick<ForgeAdapter, "readBlobBytes">;
  readonly engine: Pick<
    SyncEngine,
    "getState" | "getPendingImage" | "getRestoredImageSha"
  >;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export interface ImageResolver {
  readonly resolve: ImageSource;
  dispose(): void;
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 100;

const UNAVAILABLE: ImageSourceResult = { unavailable: true };

class ObjectUrlCache {
  private readonly entries = new Map<
    ImageId,
    { url: string; size: number }
  >();
  private totalBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEntries: number,
    private readonly revoke: (url: string) => void,
  ) {}

  get(imageId: ImageId): string | undefined {
    const entry = this.entries.get(imageId);
    if (!entry) return undefined;
    this.entries.delete(imageId);
    this.entries.set(imageId, entry);
    return entry.url;
  }

  set(imageId: ImageId, url: string, size: number): void {
    const existing = this.entries.get(imageId);
    if (existing) {
      this.entries.delete(imageId);
      this.totalBytes -= existing.size;
      if (existing.url !== url) this.revoke(existing.url);
    }
    this.entries.set(imageId, { url, size });
    this.totalBytes += size;
    while (
      this.entries.size > 1 &&
      (this.totalBytes > this.maxBytes || this.entries.size > this.maxEntries)
    ) {
      const [oldestId, oldest] = this.entries.entries().next().value!;
      this.entries.delete(oldestId);
      this.totalBytes -= oldest.size;
      this.revoke(oldest.url);
    }
  }

  clear(): void {
    for (const { url } of this.entries.values()) this.revoke(url);
    this.entries.clear();
    this.totalBytes = 0;
  }
}

export function createImageResolver(deps: ImageResolverDeps): ImageResolver {
  const createObjectUrl =
    deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl =
    deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const cache = new ObjectUrlCache(
    deps.maxBytes ?? DEFAULT_MAX_BYTES,
    deps.maxEntries ?? DEFAULT_MAX_ENTRIES,
    revokeObjectUrl,
  );
  const inFlight = new Map<ImageId, Promise<ImageSourceResult>>();
  let disposed = false;

  async function loadPayload(imageId: ImageId): Promise<ImagePayload | null> {
    const pending = deps.engine.getPendingImage(imageId);
    if (pending) return decryptImage(deps.keyring, imageId, pending.envelope);
    const images = deps.engine.getState().synced?.images;
    const blobSha =
      images?.images.get(imageId)?.blobSha ??
      images?.tombstones.get(imageId)?.blobSha ??
      deps.engine.getRestoredImageSha(imageId);
    if (blobSha === undefined) return null;
    const bytes = await deps.adapter.readBlobBytes(blobSha);
    return decryptImage(deps.keyring, imageId, bytes);
  }

  async function load(imageId: ImageId): Promise<ImageSourceResult> {
    try {
      const payload = await loadPayload(imageId);
      if (!payload) return UNAVAILABLE;
      const url = createObjectUrl(
        new Blob([payload.bytes as BlobPart], { type: payload.type }),
      );
      if (disposed) {
        revokeObjectUrl(url);
        return UNAVAILABLE;
      }
      cache.set(imageId, url, payload.bytes.byteLength);
      return { url };
    } catch {
      return UNAVAILABLE;
    }
  }

  function resolve(imageId: ImageId): Promise<ImageSourceResult> {
    if (disposed || !isImageId(imageId)) return Promise.resolve(UNAVAILABLE);
    const cached = cache.get(imageId);
    if (cached !== undefined) return Promise.resolve({ url: cached });
    const running = inFlight.get(imageId);
    if (running) return running;
    const request = load(imageId).finally(() => inFlight.delete(imageId));
    inFlight.set(imageId, request);
    return request;
  }

  return {
    resolve,
    dispose() {
      disposed = true;
      cache.clear();
    },
  };
}
