import {
  SW_STATE_CACHE,
  lookupOrder,
  planActivation,
  shellCacheName,
} from "./cache-plan";
import { planInstall } from "./install-plan";
import { routeRequest } from "./routing";

declare global {
  var __PRECACHE_MANIFEST__: { buildId: string; files: string[] };
}

declare const self: ServiceWorkerGlobalScope;

const { buildId, files } = globalThis.__PRECACHE_MANIFEST__;
const scope = self.registration.scope;
const precacheSet: ReadonlySet<string> = new Set(files);
const activeBuildKey = new URL("active-build", scope).href;
const shellUrl = new URL("index.html", scope).href;

function reloadRequest(entry: string): Request {
  return new Request(new URL(entry, scope), { cache: "reload" });
}

async function findCached(
  url: string,
  excludeCache?: string,
): Promise<Response | undefined> {
  const names = lookupOrder(await caches.keys(), buildId).filter(
    (name) => name !== excludeCache,
  );
  for (const name of names) {
    const hit = await (await caches.open(name)).match(url);
    if (hit) return hit;
  }
  return undefined;
}

async function install(): Promise<void> {
  const target = shellCacheName(buildId);
  const existing = lookupOrder(await caches.keys(), buildId).filter(
    (name) => name !== target,
  );
  const cachedUrls = new Set<string>();
  for (const name of existing) {
    const keys = await (await caches.open(name)).keys();
    for (const request of keys) cachedUrls.add(request.url);
  }

  const { reuse, fetch: toFetch } = planInstall(files, cachedUrls, scope);
  const cache = await caches.open(target);

  await Promise.all([
    cache.addAll(toFetch.map(reloadRequest)),
    ...reuse.map(async (entry) => {
      const url = new URL(entry, scope).href;
      const copy = await findCached(url, target);
      if (copy) {
        await cache.put(url, copy.clone());
      } else {
        await cache.add(reloadRequest(entry));
      }
    }),
  ]);
}

async function activate(): Promise<void> {
  const stateCache = await caches.open(SW_STATE_CACHE);
  const previous = await (await stateCache.match(activeBuildKey))?.text();
  const { remove } = planActivation(
    await caches.keys(),
    buildId,
    previous ?? null,
  );
  await Promise.all(remove.map((name) => caches.delete(name)));
  await stateCache.put(activeBuildKey, new Response(buildId));
}

async function respondFromCache(
  url: string,
  request: Request,
): Promise<Response> {
  return (await findCached(url)) ?? fetch(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil(install());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

self.addEventListener("message", (event) => {
  const data: unknown = event.data;
  if (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "SKIP_WAITING"
  ) {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const route = routeRequest(
    { url: request.url, method: request.method, mode: request.mode },
    scope,
    precacheSet,
  );
  if (route === "passthrough") return;
  event.respondWith(
    respondFromCache(route === "shell" ? shellUrl : request.url, request),
  );
});
