import type { ImageId } from "../../images/image-id";
import { referencedImageIds } from "../../images/image-reference";
import type { ReadImagePayload } from "../../images/image-resolver";

export interface PrintImagesDeps {
  readonly readImage: ReadImagePayload;
  readonly onSettled: () => void;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export interface PrintImages {
  show(text: string): void;
  readonly urls: ReadonlyMap<ImageId, string>;
  readonly version: number;
  reset(): void;
}

export function createPrintImages(deps: PrintImagesDeps): PrintImages {
  const createObjectUrl =
    deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl =
    deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const known = new Map<ImageId, string | null>();
  const reads = new Map<ImageId, number>();
  let generation = 0;
  let version = 0;
  let shownText: string | null = null;

  async function readUrl(imageId: ImageId): Promise<string | null> {
    try {
      const payload = await deps.readImage(imageId);
      if (payload === null) return null;
      return createObjectUrl(
        new Blob([payload.bytes as BlobPart], { type: payload.type }),
      );
    } catch {
      return null;
    }
  }

  function start(imageId: ImageId): void {
    const read = ++generation;
    reads.set(imageId, read);
    void readUrl(imageId).then((url) => {
      if (reads.get(imageId) !== read) {
        if (url !== null) revokeObjectUrl(url);
        return;
      }
      reads.delete(imageId);
      known.set(imageId, url);
      version++;
      if (reads.size === 0) deps.onSettled();
    });
  }

  function drop(imageId: ImageId): void {
    const url = known.get(imageId);
    if (url) revokeObjectUrl(url);
    known.delete(imageId);
  }

  return {
    show(text) {
      if (text === shownText) return;
      shownText = text;
      const ids = referencedImageIds(text);
      for (const imageId of [...known.keys()]) {
        if (!ids.has(imageId)) {
          drop(imageId);
          version++;
        }
      }
      for (const imageId of [...reads.keys()]) {
        if (!ids.has(imageId)) reads.delete(imageId);
      }
      for (const imageId of ids) {
        if (!known.has(imageId) && !reads.has(imageId)) start(imageId);
      }
    },
    get urls() {
      const urls = new Map<ImageId, string>();
      for (const [imageId, url] of known)
        if (url !== null) urls.set(imageId, url);
      return urls;
    },
    get version() {
      return version;
    },
    reset() {
      for (const imageId of [...known.keys()]) drop(imageId);
      reads.clear();
      shownText = null;
      version++;
    },
  };
}
