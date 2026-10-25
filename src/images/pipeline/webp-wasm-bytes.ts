import wasmDataUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url&inline";
import { createWasmWebpEncoder, type WasmEncode } from "./webp-wasm-encoder";

export function decodeWasmDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function createBundledWasmWebpEncoder(): Promise<WasmEncode> {
  return createWasmWebpEncoder(decodeWasmDataUrl(wasmDataUrl));
}
