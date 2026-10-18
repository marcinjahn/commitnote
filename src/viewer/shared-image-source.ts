import type { HostedShare } from "../forge/share-host";
import type { ImageId } from "../images/image-id";
import type { ImageSource, ImageSourceResult } from "../images/image-source";
import { openShareImage, type SharedImage } from "../share/share-envelope";

export interface SharedImageSourceDeps {
  readonly images: readonly SharedImage[];
  readonly hosted: Pick<HostedShare, "readImageFile">;
  readonly shareKey: CryptoKey;
  readonly createObjectUrl?: (blob: Blob) => string;
}

const UNAVAILABLE: ImageSourceResult = { unavailable: true };

export function createSharedImageSource(deps: SharedImageSourceDeps): ImageSource {
  const createObjectUrl = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const indexById = new Map(deps.images.map((image, index) => [image.imageId, index]));
  const urls = new Map<ImageId, string>();
  const inFlight = new Map<ImageId, Promise<ImageSourceResult>>();

  async function load(imageId: ImageId, index: number): Promise<ImageSourceResult> {
    try {
      const content = await deps.hosted.readImageFile(deps.images[index].file);
      const payload = await openShareImage(deps.shareKey, index, content);
      const url = createObjectUrl(new Blob([payload.bytes as BlobPart], { type: payload.type }));
      urls.set(imageId, url);
      return { url };
    } catch {
      return UNAVAILABLE;
    }
  }

  return (imageId) => {
    const cached = urls.get(imageId);
    if (cached !== undefined) return Promise.resolve({ url: cached });
    const index = indexById.get(imageId);
    if (index === undefined) return Promise.resolve(UNAVAILABLE);
    let pending = inFlight.get(imageId);
    if (!pending) {
      pending = load(imageId, index).finally(() => inFlight.delete(imageId));
      inFlight.set(imageId, pending);
    }
    return pending;
  };
}
