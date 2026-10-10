import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vitest/config";
import { buildCsp, inlineScriptHashes, type CspTarget } from "./scripts/csp.ts";
import { serviceWorker } from "./scripts/service-worker-plugin.ts";

function commitNoteCsp(target: CspTarget): Plugin {
  return {
    name: "commitnote-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = inlineScriptHashes(html);
        if (hashes.length === 0) {
          throw new Error(
            "commitnote-csp: no inline script found in index.html",
          );
        }
        const csp = buildCsp(target, hashes);
        // Returned as a raw string, not a tag descriptor: Vite's tag serializer
        // HTML-entity-escapes attribute values (e.g. ' -> &#39;), which would
        // corrupt the CSP's quoted source expressions.
        const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
        return html.replace("<head>", `<head>\n    ${tag}`);
      },
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [svelte(), commitNoteCsp("web"), serviceWorker()],
  optimizeDeps: { include: ["@replit/codemirror-vim"] },
  build: {
    assetsInlineLimit: (filePath) =>
      /\.(woff2|svg)$/.test(filePath) ? false : undefined,
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    css: { include: /\.css\?raw$/ },
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
