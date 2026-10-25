import type { ImagePayload } from "../../crypto/image-cipher";
import { stripGifMetadata } from "./gif-metadata";
import { readImageDimensions, sniffImageFormat } from "./image-format";
import {
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_PIXELS,
  NOTE_IMAGE_PROFILE,
  type ImageProfile,
} from "./image-profile";
import { fitWithin } from "./image-sizing";

export type ImageRejection =
  | { readonly kind: "notImage" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "tooLarge"; readonly limit: "input" | "gif" }
  | { readonly kind: "tooManyPixels" }
  | { readonly kind: "tooLargeAfterCompression" };

export type ImagePipelineResult =
  | { readonly ok: true; readonly payload: ImagePayload }
  | { readonly ok: false; readonly rejection: ImageRejection };

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface ImageCodec {
  decode(input: Blob): Promise<DecodedImage>;
  encodeWebp(
    image: DecodedImage,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array>;
}

function reject(rejection: ImageRejection): ImagePipelineResult {
  return { ok: false, rejection };
}

function processGif(bytes: Uint8Array, profile: ImageProfile): ImagePipelineResult {
  const dimensions = readImageDimensions(bytes, "gif");
  const stripped = stripGifMetadata(bytes);
  if (!stripped || !dimensions) return reject({ kind: "unsupported" });
  if (stripped.length > profile.maxGifBytes) {
    return reject({ kind: "tooLarge", limit: "gif" });
  }
  return {
    ok: true,
    payload: {
      type: "image/gif",
      width: dimensions.width,
      height: dimensions.height,
      bytes: stripped,
    },
  };
}

async function encodeLadder(
  decoded: DecodedImage,
  codec: ImageCodec,
  profile: ImageProfile,
): Promise<ImagePipelineResult> {
  for (const attempt of profile.attempts) {
    const { width, height } = fitWithin(
      decoded.width,
      decoded.height,
      attempt.maxLongEdge,
    );
    const bytes = await codec.encodeWebp(decoded, width, height, attempt.quality);
    if (bytes.length <= profile.maxBytes) {
      return { ok: true, payload: { type: "image/webp", width, height, bytes } };
    }
  }
  return reject({ kind: "tooLargeAfterCompression" });
}

export async function processImage(
  input: Blob,
  codec: ImageCodec,
  profile: ImageProfile = NOTE_IMAGE_PROFILE,
): Promise<ImagePipelineResult> {
  if (input.size > MAX_IMAGE_INPUT_BYTES) {
    return reject({ kind: "tooLarge", limit: "input" });
  }
  const bytes = new Uint8Array(await input.arrayBuffer());
  const format = sniffImageFormat(bytes);
  if (format === "svg") return reject({ kind: "unsupported" });
  if (format === null) {
    return reject({
      kind: input.type.startsWith("image/") ? "unsupported" : "notImage",
    });
  }

  const header = readImageDimensions(bytes, format);
  if (header && header.width * header.height > MAX_IMAGE_PIXELS) {
    return reject({ kind: "tooManyPixels" });
  }
  if (format === "gif") return processGif(bytes, profile);

  let decoded: DecodedImage;
  try {
    decoded = await codec.decode(input);
  } catch {
    return reject({ kind: "unsupported" });
  }
  try {
    if (decoded.width * decoded.height > MAX_IMAGE_PIXELS) {
      return reject({ kind: "tooManyPixels" });
    }
    return await encodeLadder(decoded, codec, profile);
  } catch {
    return reject({ kind: "unsupported" });
  } finally {
    decoded.close();
  }
}
