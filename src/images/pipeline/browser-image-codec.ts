import type { DecodedImage, ImageCodec } from "./image-pipeline";
import { loadWebpWasmEncoder } from "./load-webp-wasm-encoder";
import type { WasmEncode, WasmPixels } from "./webp-wasm-encoder";

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

interface DrawnCanvas {
  readonly context: Canvas2D;
  toBlob(type: string, quality: number): Promise<Blob | null>;
}

export interface FallbackState {
  nativeUnavailable: boolean;
}

export async function encodeWithFallback(
  state: FallbackState,
  native: () => Promise<Blob | null>,
  wasm: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (!state.nativeUnavailable) {
    const blob = await native();
    if (blob?.type === "image/webp") return new Uint8Array(await blob.arrayBuffer());
    state.nativeUnavailable = true;
  }
  return wasm();
}

class BitmapImage implements DecodedImage {
  constructor(readonly bitmap: ImageBitmap) {}

  get width(): number {
    return this.bitmap.width;
  }

  get height(): number {
    return this.bitmap.height;
  }

  close(): void {
    this.bitmap.close();
  }
}

function createCanvas(width: number, height: number): DrawnCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    return {
      context,
      toBlob: (type, quality) =>
        canvas.convertToBlob({ type, quality }).catch(() => null),
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  return {
    context,
    toBlob: (type, quality) =>
      new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
  };
}

export function createBrowserImageCodec(
  deps: { loadWasmEncoder?: () => Promise<WasmEncode> } = {},
): ImageCodec {
  const loadWasmEncoder = deps.loadWasmEncoder ?? loadWebpWasmEncoder;
  const state: FallbackState = { nativeUnavailable: false };

  return {
    async decode(input) {
      return new BitmapImage(
        await createImageBitmap(input, { imageOrientation: "from-image" }),
      );
    },

    async encodeWebp(image, width, height, quality) {
      if (!(image instanceof BitmapImage)) {
        throw new Error("Image was not decoded by this codec");
      }
      const canvas = createCanvas(width, height);
      canvas.context.imageSmoothingEnabled = true;
      canvas.context.imageSmoothingQuality = "high";
      canvas.context.drawImage(image.bitmap, 0, 0, width, height);
      return encodeWithFallback(
        state,
        () => canvas.toBlob("image/webp", quality),
        async () => {
          const encode = await loadWasmEncoder();
          const pixels: WasmPixels = canvas.context.getImageData(0, 0, width, height);
          return encode(pixels, quality);
        },
      );
    },
  };
}
