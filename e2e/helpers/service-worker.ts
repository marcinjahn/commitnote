import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview, type Plugin, type PreviewServer } from "vite";
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

export async function waitForWaitingWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null,
        ),
      { timeout: 15_000 },
    )
    .toBe("installed");
}

export async function activeBuildId(page: Page): Promise<string | null> {
  return page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return null;
      const cache = await caches.open("commitnote-sw-state");
      const hit = await cache.match(new URL("active-build", registration.scope).href);
      return hit ? hit.text() : null;
    })
    .catch(() => null);
}

export async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
}

export interface ShellServer {
  readonly origin: string;
  readonly appURL: string;
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

async function servePreview(
  dir: string,
  plugins: Plugin[] = [],
): Promise<{ server: PreviewServer; origin: string }> {
  const port = await freePort();
  const server = await preview({
    configFile: false,
    root: dir,
    logLevel: "silent",
    build: { outDir: dir },
    preview: { port, strictPort: true, host: "localhost" },
    plugins,
  });
  return { server, origin: `http://localhost:${port}` };
}

/**
 * Serves a private copy of the fake-forge build, so its `sw.js` can be
 * rewritten to a second build id. Playwright routing does not see the
 * browser's service worker script update checks.
 */
export async function startShellServer(): Promise<ShellServer> {
  const dir = await mkdtemp(join(tmpdir(), "commitnote-shell-"));
  await cp(FAKE_BUILD_DIR, dir, { recursive: true });
  const appDir = join(dir, "app");
  const swPath = join(appDir, "sw.js");
  const source = await readFile(swPath, "utf8");
  const manifest = parsePrecacheManifest(source);
  if (manifest === null) throw new Error("sw.js has no precache manifest");

  const counts = new Map<string, number>();
  const { server, origin } = await servePreview(dir, [
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
  ]);

  return {
    origin,
    appURL: `${origin}/app/`,
    manifest,
    requestCount: (path) => counts.get(path) ?? 0,
    resetRequestCounts: () => counts.clear(),
    async serveSecondBuild({ drop = [] } = {}) {
      const body = source.slice(source.indexOf("\n") + 1);
      await Promise.all(drop.map((file) => rm(join(appDir, file))));
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
