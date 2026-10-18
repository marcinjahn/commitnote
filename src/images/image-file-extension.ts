import type { ImageType } from "../crypto/image-cipher";

export function imageFileExtension(type: ImageType): "webp" | "gif" {
  return type === "image/gif" ? "gif" : "webp";
}
