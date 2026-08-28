import { ForgeError } from "../errors";

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

export async function sendGitHubRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  pathOrUrl: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${API_BASE}${pathOrUrl}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
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
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds)) {
      return Math.max(0, resetSeconds * 1000 - now());
    }
  }
  return 60_000;
}

export async function gitHubErrorFor(
  response: Response,
  now: () => number,
): Promise<ForgeError> {
  const status = response.status;
  let message: string | undefined;
  try {
    const body: unknown = await response.clone().json();
    if (
      body !== null &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
    ) {
      message = (body as { message: string }).message;
    }
  } catch {
    // non-JSON or empty body: leave message undefined
  }

  if (status === 401) {
    return new ForgeError("Unauthorized", { status, message });
  }
  if (status === 429) {
    return new ForgeError("RateLimited", {
      status,
      message,
      retryAfterMs: retryAfterMs(response, now),
    });
  }
  if (status === 403) {
    const isRateLimited =
      response.headers.get("retry-after") !== null ||
      response.headers.get("x-ratelimit-remaining") === "0" ||
      (message !== undefined && /rate limit/i.test(message));
    if (isRateLimited) {
      return new ForgeError("RateLimited", {
        status,
        message,
        retryAfterMs: retryAfterMs(response, now),
      });
    }
    return new ForgeError("Forbidden", { status, message });
  }
  if (status === 404) {
    return new ForgeError("NotFound", { status, message });
  }
  return new ForgeError("Server", { status, message });
}
