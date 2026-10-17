import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, type Plugin, type ResolvedConfig } from "vite";
import {
  computeBuildId,
  formatPrecacheManifest,
  listPrecacheFiles,
} from "./precache-manifest.ts";

const WORKER_ENTRY = "src/service-worker/sw.ts";

async function bundleWorker(root: string): Promise<string> {
  const result = await build({
    configFile: false,
    root,
    logLevel: "warn",
    plugins: [],
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      rolldownOptions: {
        input: resolve(root, WORKER_ENTRY),
        output: {
          format: "iife",
          entryFileNames: "sw.js",
        },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  if (!("output" in outputs[0])) {
    throw new Error("service-worker: build did not return output");
  }
  const chunks = outputs.flatMap((entry) =>
    "output" in entry ? entry.output : [],
  );
  if (chunks.length !== 1 || chunks[0].type !== "chunk") {
    throw new Error("service-worker: expected a single chunk");
  }
  return chunks[0].code;
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  let outDir: string;

  return {
    name: "commitnote-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
      outDir = resolve(resolved.root, resolved.build.outDir);
    },
    async closeBundle() {
      if (existsSync(join(config.root, "public", "sw.js"))) {
        config.logger.warn(
          "service-worker: public/sw.js exists, shipping the kill-switch service worker",
        );
        return;
      }
      const paths = await listPrecacheFiles(outDir);
      const files = await Promise.all(
        paths.map(async (path) => ({
          path,
          content: await readFile(join(outDir, path)),
        })),
      );
      const buildId = computeBuildId(files);
      const code = await bundleWorker(config.root);
      await writeFile(
        join(outDir, "sw.js"),
        formatPrecacheManifest({ buildId, files: paths }) + code,
      );
    },
  };
}
