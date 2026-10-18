import type { WasmEncode } from "./webp-wasm-encoder";

let pending: Promise<WasmEncode> | null = null;

function importEncoder(): Promise<WasmEncode> {
  return import("./webp-wasm-bytes").then((module) =>
    module.createBundledWasmWebpEncoder(),
  );
}

export function loadWebpWasmEncoder(): Promise<WasmEncode> {
  pending ??= importEncoder().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
