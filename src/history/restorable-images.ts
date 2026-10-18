import type { TreeEntry } from "../forge/forge-adapter";
import { type ImageId, imageFilePath } from "../images/image-id";
import type { ImageIndex } from "../images/image-index";
import { referencedImageIds } from "../images/image-reference";

type IsPending = (imageId: ImageId) => boolean;

function isMissing(
  imageId: ImageId,
  images: ImageIndex,
  isPending: IsPending,
): boolean {
  return (
    !images.images.has(imageId) &&
    !images.tombstones.has(imageId) &&
    !isPending(imageId)
  );
}

export function needsImageLookup(
  content: string,
  images: ImageIndex,
  isPending: IsPending,
): boolean {
  for (const imageId of referencedImageIds(content)) {
    if (isMissing(imageId, images, isPending)) return true;
  }
  return false;
}

export function findRestorableImages(input: {
  content: string;
  images: ImageIndex;
  isPending: IsPending;
  versionListing: readonly TreeEntry[];
}): Map<ImageId, string> {
  const found = new Map<ImageId, string>();
  if (!input.images.writable) return found;
  const shaByPath = new Map<string, string>();
  for (const entry of input.versionListing) {
    if (entry.type === "blob") shaByPath.set(entry.path, entry.sha);
  }
  for (const imageId of referencedImageIds(input.content)) {
    if (!isMissing(imageId, input.images, input.isPending)) continue;
    const sha = shaByPath.get(imageFilePath(imageId));
    if (sha !== undefined) found.set(imageId, sha);
  }
  return found;
}
