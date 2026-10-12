import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rename,
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

/**
 * Playwright keeps DevTools attached to service workers, which turns off
 * Chrome's idle detection, so a worker that calls `skipWaiting()` can wait
 * forever for the worker it replaces to go idle. Stopping the outgoing worker
 * as soon as its replacement is waiting stands in for that idle termination.
 */
export async function stopReplacedWorkers(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const versions = new Map<
    string,
    { registrationId: string; status: string; runningStatus: string }
  >();
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }) => {
    for (const update of updates) versions.set(update.versionId, update);
    for (const [versionId, version] of versions) {
      const replaced =
        version.status === "activated" &&
        version.runningStatus === "running" &&
        [...versions.values()].some(
          (other) =>
            other.registrationId === version.registrationId &&
            other.status === "installed",
        );
      if (replaced) {
        cdp.send("ServiceWorker.stopWorker", { versionId }).catch(() => undefined);
      }
    }
  });
  await cdp.send("ServiceWorker.enable");
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

export interface SiteServer {
  readonly origin: string;
  serveOldLayout(options?: { renameAssets?: boolean }): Promise<void>;
  serveSite(options?: { keepOldAssets?: boolean }): Promise<void>;
  close(): Promise<void>;
}

const OLD_ASSETS_DIR = "old-assets";

/**
 * Serves a mutable directory that first holds the pre-move layout (the app at
 * the server root, its worker at `/sw.js` with scope `/`) and can later be
 * swapped to today's site, the way a deployment replaces one with the other.
 * `renameAssets` moves the old build's assets out of the way, as in
 * production, where the old hashed files do not exist under `/app/`.
 */
export async function startSiteServer(): Promise<SiteServer> {
  const dir = await mkdtemp(join(tmpdir(), "commitnote-site-"));
  const { server, origin } = await servePreview(dir);

  async function clear(): Promise<void> {
    for (const entry of await readdir(dir)) {
      await rm(join(dir, entry), { recursive: true, force: true });
    }
  }

  async function renameOldAssets(): Promise<void> {
    await rename(join(dir, "assets"), join(dir, OLD_ASSETS_DIR));
    const texts = [
      "index.html",
      "sw.js",
      ...(await readdir(join(dir, OLD_ASSETS_DIR)))
        .filter((name) => /\.(js|css)$/.test(name))
        .map((name) => join(OLD_ASSETS_DIR, name)),
    ];
    for (const file of texts) {
      const path = join(dir, file);
      const text = await readFile(path, "utf8");
      await writeFile(path, text.replaceAll("assets/", `${OLD_ASSETS_DIR}/`));
    }
  }

  return {
    origin,
    async serveOldLayout({ renameAssets = false } = {}) {
      await clear();
      await cp(join(FAKE_BUILD_DIR, "app"), dir, { recursive: true });
      if (renameAssets) await renameOldAssets();
    },
    async serveSite({ keepOldAssets = false } = {}) {
      await clear();
      await cp(FAKE_BUILD_DIR, dir, { recursive: true });
      if (keepOldAssets) {
        await cp(join(FAKE_BUILD_DIR, "app", "assets"), join(dir, "assets"), {
          recursive: true,
        });
      }
    },
    async close() {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
