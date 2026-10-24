import type { Plugin } from "vite";
import { buildCsp, inlineScriptHashes, type CspTarget } from "./csp.ts";

export function commitNoteCsp(target: CspTarget): Plugin {
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
