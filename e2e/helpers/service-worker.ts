import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import {
  formatPrecacheManifest,
  parsePrecacheManifest,
  type PrecacheManifest,
} from "../../scripts/precache-manifest";

export const SECOND_BUILD_ID = "e2e-second-build";

const FAKE_BUILD_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist-fake",
);

export async function waitForActiveWorker(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.ready).active?.state,
      ),
    )
    .toBe("activated");
}

export async function reloadControlled(page: Page): Promise<void> {
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

export async function shellCacheNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.startsWith("commitnote-shell-")),
  );
}

export async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
}

export interface ShellServer {
  readonly origin: string;
  readonly manifest: PrecacheManifest;
  requestCount(path: string): number;
  resetRequestCounts(): void;
  serveSecondBuild(options?: { drop?: readonly string[] }): Promise<void>;
  close(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "localhost", () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === "object") {
          resolvePort(address.port);
        } else {
          reject(new Error("no port assigned"));
        }
      });
    });
  });
}

/**
 * Serves a private copy of the fake-forge build, so its `sw.js` can be
 * rewritten to a second build id. Playwright routing does not see the
 * browser's service worker script update checks.
 */
export async function startShellServer(): Promise<ShellServer> {
  const dir = await mkdtemp(join(tmpdir(), "commitnote-shell-"));
  await cp(FAKE_BUILD_DIR, dir, { recursive: true });
  const swPath = join(dir, "sw.js");
  const source = await readFile(swPath, "utf8");
  const manifest = parsePrecacheManifest(source);
  if (manifest === null) throw new Error("sw.js has no precache manifest");

  const counts = new Map<string, number>();
  const port = await freePort();
  const server = await preview({
    configFile: false,
    root: dir,
    logLevel: "silent",
    build: { outDir: dir },
    preview: { port, strictPort: true, host: "localhost" },
    plugins: [
      {
        name: "count-requests",
        configurePreviewServer(previewServer) {
          previewServer.middlewares.use((req, _res, next) => {
            const path = new URL(req.url ?? "/", "http://localhost").pathname;
            counts.set(path, (counts.get(path) ?? 0) + 1);
            next();
          });
        },
      },
    ],
  });

  return {
    origin: `http://localhost:${port}`,
    manifest,
    requestCount: (path) => counts.get(path) ?? 0,
    resetRequestCounts: () => counts.clear(),
    async serveSecondBuild({ drop = [] } = {}) {
      const body = source.slice(source.indexOf("\n") + 1);
      await Promise.all(drop.map((file) => rm(join(dir, file))));
      await writeFile(
        swPath,
        formatPrecacheManifest({
          buildId: SECOND_BUILD_ID,
          files: manifest.files.filter((file) => !drop.includes(file)),
        }) + body,
      );
    },
    async close() {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
