import moduleFactory from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";

export interface WasmPixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export type WasmEncode = (pixels: WasmPixels, quality: number) => Uint8Array;

export async function createWasmWebpEncoder(
  wasmBytes: Uint8Array,
): Promise<WasmEncode> {
  const wasmModule = await WebAssembly.compile(new Uint8Array(wasmBytes));
  const webp = await moduleFactory({
    noInitialRun: true,
    instantiateWasm: (
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance) => void,
    ) => {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      successCallback(instance);
      return instance.exports;
    },
  });
  return (pixels, quality) => {
    const encoded = webp.encode(pixels.data, pixels.width, pixels.height, {
      ...defaultOptions,
      quality: Math.round(quality * 100),
    });
    if (!encoded) throw new Error("WebP encoding failed");
    return new Uint8Array(encoded);
  };
}
