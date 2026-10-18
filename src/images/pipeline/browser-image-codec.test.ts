import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserImageCodec,
  encodeWithFallback,
  type FallbackState,
} from "./browser-image-codec";

const WASM_OUTPUT = Uint8Array.of(9, 9, 9);
const NATIVE_BYTES = Uint8Array.of(1, 2, 3);

const blobOf = (type: string) => new Blob([NATIVE_BYTES], { type });

describe("encodeWithFallback", () => {
  it("uses native output when the browser encodes WebP", async () => {
    const state: FallbackState = { nativeUnavailable: false };
    const wasm = vi.fn(async () => WASM_OUTPUT);

    const bytes = await encodeWithFallback(state, async () => blobOf("image/webp"), wasm);

    expect(bytes).toEqual(NATIVE_BYTES);
    expect(wasm).not.toHaveBeenCalled();
    expect(state.nativeUnavailable).toBe(false);
  });

  it.each([
    ["a PNG blob", blobOf("image/png")],
    ["no blob", null],
  ])("falls back to WASM when native encoding returns %s", async (_, blob) => {
    const state: FallbackState = { nativeUnavailable: false };

    const bytes = await encodeWithFallback(state, async () => blob, async () => WASM_OUTPUT);

    expect(bytes).toBe(WASM_OUTPUT);
    expect(state.nativeUnavailable).toBe(true);
  });

  it("skips native encoding once it is known to be unavailable", async () => {
    const native = vi.fn(async () => blobOf("image/webp"));

    const bytes = await encodeWithFallback(
      { nativeUnavailable: true },
      native,
      async () => WASM_OUTPUT,
    );

    expect(bytes).toBe(WASM_OUTPUT);
    expect(native).not.toHaveBeenCalled();
  });
});

describe("createBrowserImageCodec", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCanvas(outputType: string) {
    const pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: vi.fn(),
      getImageData: vi.fn(() => pixels),
    };
    const convertToBlob = vi.fn(async () => blobOf(outputType));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext = () => context;
        convertToBlob = convertToBlob;
      },
    );
    const bitmap = { width: 4, height: 4, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    return { context, convertToBlob, pixels, bitmap };
  }

  it("encodes natively without loading the WASM encoder", async () => {
    const { context, bitmap } = stubCanvas("image/webp");
    const loadWasmEncoder = vi.fn();
    const codec = createBrowserImageCodec({ loadWasmEncoder });

    const image = await codec.decode(new Blob());
    const bytes = await codec.encodeWebp(image, 2, 2, 0.85);

    expect(bytes).toEqual(NATIVE_BYTES);
    expect(loadWasmEncoder).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2, 2);
    expect(context.imageSmoothingQuality).toBe("high");
    image.close();
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("encodes canvas pixels with WASM and remembers native WebP is unavailable", async () => {
    const { convertToBlob, pixels } = stubCanvas("image/png");
    const encode = vi.fn(() => WASM_OUTPUT);
    const codec = createBrowserImageCodec({ loadWasmEncoder: async () => encode });
    const image = await codec.decode(new Blob());

    expect(await codec.encodeWebp(image, 2, 2, 0.85)).toBe(WASM_OUTPUT);
    expect(await codec.encodeWebp(image, 2, 2, 0.7)).toBe(WASM_OUTPUT);

    expect(encode).toHaveBeenNthCalledWith(1, pixels, 0.85);
    expect(encode).toHaveBeenNthCalledWith(2, pixels, 0.7);
    expect(convertToBlob).toHaveBeenCalledTimes(1);
  });
});
