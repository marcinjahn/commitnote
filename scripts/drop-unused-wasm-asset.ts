import type { Plugin } from "vite";

/**
 * The emscripten glue references its .wasm file through `new URL(...)`, but
 * the app always instantiates from bytes embedded in a lazy chunk, so the
 * emitted file would never be requested.
 */
export function dropUnusedWasmAsset(): Plugin {
  return {
    name: "commitnote-drop-unused-wasm-asset",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === "asset" && /^assets\/webp_enc-.*\.wasm$/.test(fileName)) {
          delete bundle[fileName];
        }
      }
    },
  };
}
