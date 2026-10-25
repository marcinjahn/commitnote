import { describe, expect, it } from "vitest";
import wasmDataUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url&inline";
import { decodeWasmDataUrl } from "./webp-wasm-bytes";
import { createWasmWebpEncoder } from "./webp-wasm-encoder";

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 255) / (width - 1);
      data[offset + 1] = (y * 255) / (height - 1);
      data[offset + 2] = 128;
      data[offset + 3] = 255;
    }
  }
  return data;
}

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("createWasmWebpEncoder", () => {
  it("encodes RGBA pixels to WebP with the bundled WASM", async () => {
    expect(wasmDataUrl.startsWith("data:")).toBe(true);
    const encode = await createWasmWebpEncoder(decodeWasmDataUrl(wasmDataUrl));

    const output = encode({ data: gradient(16, 8), width: 16, height: 8 }, 0.8);

    expect(ascii(output.subarray(0, 4))).toBe("RIFF");
    expect(ascii(output.subarray(8, 12))).toBe("WEBP");
  });
});
