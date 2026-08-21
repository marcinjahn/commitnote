import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vitest/config";

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function commitNoteCsp(): Plugin {
  return {
    name: "commitnote-csp",
    apply: "build",
    transformIndexHtml(html) {
      // Returned as a raw string, not a tag descriptor: Vite's tag serializer
      // HTML-entity-escapes attribute values (e.g. ' -> &#39;), which would
      // corrupt the CSP's quoted source expressions.
      const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
      return html.replace("<head>", `<head>\n    ${tag}`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [svelte(), commitNoteCsp()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
