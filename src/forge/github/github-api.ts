import { ForgeError } from "../errors";
import { retryAfterMs, sendForgeRequest } from "../forge-http";

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

export function sendGitHubRequest(
  fetchImpl: typeof fetch,
  accessToken: string,
  pathOrUrl: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${API_BASE}${pathOrUrl}`;
  return sendForgeRequest(fetchImpl, url, accessToken, init, {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  });
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
      retryAfterMs: retryAfterMs(response, now, "x-ratelimit-reset"),
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
        retryAfterMs: retryAfterMs(response, now, "x-ratelimit-reset"),
      });
    }
    return new ForgeError("Forbidden", { status, message });
  }
  if (status === 404) {
    return new ForgeError("NotFound", { status, message });
  }
  return new ForgeError("Server", { status, message });
}
