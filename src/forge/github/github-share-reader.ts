import { defaultFetch } from "../forge-http";
import { ShareReadError, type ShareReader } from "../share-host";
import { API_BASE } from "./github-api";

const SHARE_FILE = "commitnote-share.json";

async function isRateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (
    response.headers.has("retry-after") ||
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    return true;
  }
  try {
    const body: unknown = await response.json();
    const message =
      typeof body === "object" && body !== null
        ? (body as { message?: unknown }).message
        : undefined;
    return typeof message === "string" && /rate limit/i.test(message);
  } catch {
    return false;
  }
}

export function createGitHubShareReader(
  options: { fetch?: typeof fetch } = {},
): ShareReader {
  const fetchImpl = options.fetch ?? defaultFetch;
  return {
    async read(locator) {
      if (locator.provider !== "github") throw new ShareReadError("damaged");
      let response: Response;
      try {
        response = await fetchImpl(
          `${API_BASE}/gists/${locator.gistId}`,
          {
            method: "GET",
            headers: { Accept: "application/vnd.github+json" },
            credentials: "omit",
            referrerPolicy: "no-referrer",
            cache: "no-store",
          },
        );
      } catch {
        throw new ShareReadError("network");
      }

      if (response.status === 200) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new ShareReadError("damaged");
        }
        const files =
          typeof body === "object" && body !== null
            ? (body as { files?: unknown }).files
            : undefined;
        const file =
          typeof files === "object" && files !== null
            ? (files as Record<string, unknown>)[SHARE_FILE]
            : undefined;
        if (typeof file !== "object" || file === null) {
          throw new ShareReadError("damaged");
        }
        const { content, truncated } = file as {
          content?: unknown;
          truncated?: unknown;
        };
        if (truncated === true || typeof content !== "string") {
          throw new ShareReadError("damaged");
        }
        return content;
      }
      if (response.status === 404) throw new ShareReadError("notFound");
      if (await isRateLimited(response)) throw new ShareReadError("rateLimited");
      if (response.status === 403) throw new ShareReadError("notFound");
      throw new ShareReadError("server");
    },
  };
}
