import {
  processImage,
  type DecodedImage,
  type ImageCodec,
  type ImagePipelineResult,
} from "../images/pipeline/image-pipeline";
import type { ImageProfile } from "../images/pipeline/image-profile";
import type { HostImageCodec, ImageHandle } from "./host-services";

interface HostImageState {
  readonly handle: ImageHandle;
  released: boolean;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function createHostImageCodec(codec: HostImageCodec): ImageCodec {
  const decoded = new WeakMap<DecodedImage, HostImageState>();

  return {
    async decode(input) {
      const bytes = new Uint8Array(await input.arrayBuffer());
      const result = await codec.decode(bytes);
      if (
        !isPositiveInteger(result.width) ||
        !isPositiveInteger(result.height)
      ) {
        codec.release(result.handle);
        throw new Error("Host image codec returned invalid dimensions");
      }
      const state: HostImageState = { handle: result.handle, released: false };
      const image: DecodedImage = {
        width: result.width,
        height: result.height,
        close() {
          if (state.released) return;
          state.released = true;
          codec.release(state.handle);
        },
      };
      decoded.set(image, state);
      return image;
    },
    async encodeWebp(image, width, height, quality) {
      const state = decoded.get(image);
      if (state === undefined || state.released) {
        throw new Error("Image was not decoded by this codec");
      }
      const encoded = await codec.encodeWebp(
        state.handle,
        width,
        height,
        quality,
      );
      if (!ArrayBuffer.isView(encoded)) {
        throw new Error("Host image codec returned no bytes");
      }
      const copy = new Uint8Array(encoded.byteLength);
      copy.set(
        new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength),
      );
      return copy;
    },
  };
}

export function processHostImage(
  codec: HostImageCodec,
  input: Blob,
  profile?: ImageProfile,
): Promise<ImagePipelineResult> {
  return processImage(input, createHostImageCodec(codec), profile);
}
