import { createHash } from "node:crypto";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vitest/config";

const SCRIPT_SRC = "script-src 'self' 'wasm-unsafe-eval'";
const CSP_TEMPLATE =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(
    /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    const digest = createHash("sha256").update(match[1]).digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function commitNoteCsp(): Plugin {
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
        const csp = CSP_TEMPLATE.replace(
          SCRIPT_SRC,
          `${SCRIPT_SRC} ${hashes.join(" ")}`,
        );
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
  plugins: [svelte(), commitNoteCsp()],
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
