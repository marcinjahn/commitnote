import { isContentHashed } from "./install-plan";

export type ShellRoute = "shell" | "asset" | "passthrough";

export interface RoutedRequest {
  url: string;
  method: string;
  mode: string;
}

export function routeRequest(
  request: RoutedRequest,
  scope: string,
  precache: ReadonlySet<string>,
): ShellRoute {
  if (request.method !== "GET") return "passthrough";

  let url: URL;
  let scopeUrl: URL;
  try {
    url = new URL(request.url);
    scopeUrl = new URL(scope);
  } catch {
    return "passthrough";
  }

  if (url.origin !== scopeUrl.origin) return "passthrough";
  if (!url.href.startsWith(scopeUrl.href)) return "passthrough";
  if (request.mode === "navigate") return "shell";
  if (url.search !== "") return "passthrough";

  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(scopeUrl.pathname.length));
  } catch {
    return "passthrough";
  }
  return precache.has(path) || isContentHashed(path) ? "asset" : "passthrough";
}
