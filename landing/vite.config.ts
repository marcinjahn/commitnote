import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";
import { commitNoteCsp } from "../scripts/csp-plugin.ts";

const landingRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(landingRoot, "..");
const BOOT_MARKER = "<!--landing-boot-->";

async function bundleBoot(): Promise<string> {
  const result = await build({
    configFile: false,
    root: landingRoot,
    logLevel: "warn",
    plugins: [],
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      rolldownOptions: {
        input: resolve(landingRoot, "src/boot.ts"),
        output: { format: "iife", entryFileNames: "boot.js" },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((entry) =>
    "output" in entry ? entry.output : [],
  );
  if (chunks.length !== 1 || chunks[0].type !== "chunk") {
    throw new Error("landing-boot: expected a single chunk");
  }
  return chunks[0].code.trim();
}

function landingBoot(): Plugin {
  return {
    name: "commitnote-landing-boot",
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        if (!html.includes(BOOT_MARKER)) {
          throw new Error(`landing-boot: ${BOOT_MARKER} marker not found`);
        }
        const code = await bundleBoot();
        if (code.includes("</script")) {
          throw new Error("landing-boot: boot script contains </script");
        }
        return html.replace(BOOT_MARKER, () => `<script>${code}</script>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: landingRoot,
  base: "./",
  publicDir: resolve(landingRoot, "public"),
  plugins: [landingBoot(), commitNoteCsp("landing")],
  server: { fs: { allow: [repoRoot] } },
  build: {
    outDir: resolve(repoRoot, mode === "fake-forge" ? "dist-fake" : "dist"),
    emptyOutDir: true,
    assetsInlineLimit: (filePath: string) =>
      /\.(woff2|svg)$/.test(filePath) ? false : undefined,
  },
}));
