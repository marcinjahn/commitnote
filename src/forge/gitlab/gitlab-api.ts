import { ForgeError } from "../errors";

export const GITLAB_API_BASE = "https://gitlab.com/api/v4";

export const GITLAB_DEVELOPER_ACCESS_LEVEL = 30;

// Only Authorization and Content-Type are sent, both of which GitLab's API
// allows in CORS preflights.
export async function sendGitLabRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  pathOrUrl: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${GITLAB_API_BASE}${pathOrUrl}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  const requestInit: RequestInit = {
    method: init.method,
    headers,
    cache: "no-store",
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(init.body);
  }

  try {
    return await fetchImpl(url, requestInit);
  } catch (cause) {
    throw new ForgeError("Network", { cause });
  }
}

function retryAfterMs(response: Response, now: () => number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }
  const reset = response.headers.get("ratelimit-reset");
  if (reset !== null) {
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds)) {
      return Math.max(0, resetSeconds * 1000 - now());
    }
  }
  return 60_000;
}

// GitLab's error bodies can quote file paths (e.g. on a rejected commit
// action), so their text is never carried into the ForgeError.
export function gitLabErrorFor(
  response: Response,
  now: () => number,
): ForgeError {
  const status = response.status;
  if (status === 401) {
    return new ForgeError("Unauthorized", { status });
  }
  const isRateLimited =
    status === 429 ||
    (status === 403 &&
      (response.headers.get("retry-after") !== null ||
        response.headers.get("ratelimit-remaining") === "0"));
  if (isRateLimited) {
    return new ForgeError("RateLimited", {
      status,
      retryAfterMs: retryAfterMs(response, now),
    });
  }
  if (status === 403) {
    return new ForgeError("Forbidden", { status });
  }
  if (status === 404) {
    return new ForgeError("NotFound", { status });
  }
  return new ForgeError("Server", { status });
}

// Follows keyset pagination (Link rel="next") and falls back to offset
// pagination (x-next-page) for endpoints or instances that only send that.
export function nextPageUrl(
  response: Response,
  currentUrl: string,
): string | null {
  const link = response.headers.get("link");
  if (link !== null) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(link);
    if (match) return match[1];
  }
  const nextPage = response.headers.get("x-next-page");
  if (nextPage !== null && nextPage !== "") {
    const url = new URL(
      currentUrl.startsWith("https://")
        ? currentUrl
        : `${GITLAB_API_BASE}${currentUrl}`,
    );
    url.searchParams.set("page", nextPage);
    return url.toString();
  }
  return null;
}

export function projectApiPath(owner: string, repo: string): string {
  return `/projects/${encodeURIComponent(`${owner}/${repo}`)}`;
}
