import type { ShareContent } from "./share-host";

export const SHARE_FILE = "commitnote-share.json";

const IMAGE_FILE_PATTERN = /^commitnote-image-(0|[1-9][0-9]*)\.json$/;

export function shareImageFileName(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("Image file index must be a non-negative integer");
  }
  return `commitnote-image-${index}.json`;
}

export function isShareImageFileName(name: string): boolean {
  return IMAGE_FILE_PATTERN.test(name);
}

export function shareContentFiles(content: ShareContent): Record<string, string> {
  const files: Record<string, string> = { [SHARE_FILE]: content.envelope };
  content.images.forEach((image, index) => {
    files[shareImageFileName(index)] = image;
  });
  return files;
}
