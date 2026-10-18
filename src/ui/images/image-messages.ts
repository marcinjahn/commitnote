import type { ImageRejection } from "../../images/pipeline/image-pipeline";

export const IMAGE_COUNT_LIMIT_MESSAGE = "You can add up to 10 images at a time.";

export function describeImageRejection(rejection: ImageRejection): string {
  switch (rejection.kind) {
    case "notImage":
      return "This file is not an image.";
    case "unsupported":
      return "This image format is not supported.";
    case "tooLarge":
      return rejection.limit === "gif"
        ? "This GIF is too large. The limit is 5 MB."
        : "This image is too large. The limit is 25 MB.";
    case "tooManyPixels":
      return "This image has too many pixels. The limit is 50 megapixels.";
    case "tooLargeAfterCompression":
      return "This image is still too large after compression.";
  }
}

export function describeImageRejections(
  rejections: readonly ImageRejection[],
  total: number,
): string | null {
  if (rejections.length === 0) return null;
  if (rejections.length === 1) return describeImageRejection(rejections[0]!);
  return `${rejections.length} of ${total} images could not be added.`;
}

export function describeAddingImages(count: number): string {
  return count === 1 ? "Adding image…" : "Adding images…";
}
