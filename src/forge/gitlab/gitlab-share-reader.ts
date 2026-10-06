import { defaultFetch } from "../forge-http";
import { ShareReadError, type ShareReader } from "../share-host";
import { GITLAB_API_BASE } from "./gitlab-api";

export function createGitLabShareReader(
  options: { fetch?: typeof fetch } = {},
): ShareReader {
  const fetchImpl = options.fetch ?? defaultFetch;
  return {
    async read(locator) {
      if (locator.provider !== "gitlab") throw new ShareReadError("damaged");
      let response: Response;
      try {
        response = await fetchImpl(
          `${GITLAB_API_BASE}/snippets/${locator.snippetId}/raw`,
          {
            method: "GET",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            cache: "no-store",
          },
        );
      } catch {
        throw new ShareReadError("network");
      }

      if (response.status === 200) {
        try {
          return await response.text();
        } catch {
          throw new ShareReadError("network");
        }
      }
      if (response.status === 404) throw new ShareReadError("notFound");
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.has("retry-after") ||
            response.headers.get("ratelimit-remaining") === "0"))
      ) {
        throw new ShareReadError("rateLimited");
      }
      if (response.status === 403) throw new ShareReadError("notFound");
      throw new ShareReadError("server");
    },
  };
}
