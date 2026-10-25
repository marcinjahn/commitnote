import type { ImageId } from "./image-id";

export type ImageSourceResult =
  | { readonly url: string }
  | { readonly unavailable: true };

export type ImageSource = (imageId: ImageId) => Promise<ImageSourceResult>;
