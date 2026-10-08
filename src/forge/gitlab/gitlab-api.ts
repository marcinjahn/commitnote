import { ForgeError } from "../errors";
import { retryAfterMs, sendForgeRequest } from "../forge-http";
import { parseLinkHeader } from "../link-header";

export const GITLAB_API_BASE = "https://gitlab.com/api/v4";

export const GITLAB_DEVELOPER_ACCESS_LEVEL = 30;

// Only Authorization and Content-Type are sent, both of which GitLab's API
// allows in CORS preflights.
export async function sendGitLabRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  pathOrUrl: string,
  init: { method: string; body?: unknown },
  onResponse?: (response: Response) => void,
): Promise<Response> {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${GITLAB_API_BASE}${pathOrUrl}`;
  const response = await sendForgeRequest(fetchImpl, url, accessToken, init);
  onResponse?.(response);
  return response;
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
      retryAfterMs: retryAfterMs(response, now, "ratelimit-reset"),
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
  const next = parseLinkHeader(response.headers.get("link")).get("next");
  if (next !== undefined) return next;
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
