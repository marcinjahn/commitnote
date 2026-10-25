import { defaultFetch } from "../forge-http";
import { isShareImageFileName, SHARE_FILE } from "../share-files";
import { ShareReadError, type ShareReader } from "../share-host";
import { GITLAB_API_BASE } from "./gitlab-api";

const RAW_SEGMENT = "/raw/";

function refOf(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  const start = rawUrl.indexOf(RAW_SEGMENT);
  if (start < 0) return null;
  const rest = rawUrl.slice(start + RAW_SEGMENT.length);
  const end = rest.indexOf("/");
  return end > 0 ? rest.slice(0, end) : null;
}

export function createGitLabShareReader(
  options: { fetch?: typeof fetch } = {},
): ShareReader {
  const fetchImpl = options.fetch ?? defaultFetch;

  async function get(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
    } catch {
      throw new ShareReadError("network");
    }
    if (response.status === 200) return response;
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
  }

  async function bodyText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      throw new ShareReadError("network");
    }
  }

  return {
    async read(locator) {
      if (locator.provider !== "gitlab") throw new ShareReadError("damaged");
      const snippetId = encodeURIComponent(locator.snippetId);
      const metadataText = await bodyText(
        await get(`${GITLAB_API_BASE}/snippets/${snippetId}`),
      );

      let files: unknown;
      try {
        files = (JSON.parse(metadataText) as { files?: unknown }).files;
      } catch {
        throw new ShareReadError("damaged");
      }
      if (!Array.isArray(files)) throw new ShareReadError("damaged");

      const refs = new Map<string, string>();
      for (const file of files as { path?: unknown; raw_url?: unknown }[]) {
        if (typeof file?.path !== "string") continue;
        const ref = refOf(file.raw_url);
        if (ref !== null) refs.set(file.path, ref);
      }

      async function readFile(name: string): Promise<string> {
        const ref = refs.get(name);
        if (ref === undefined) throw new ShareReadError("damaged");
        return bodyText(
          await get(
            `${GITLAB_API_BASE}/snippets/${snippetId}/files/${encodeURIComponent(ref)}/${encodeURIComponent(name)}/raw`,
          ),
        );
      }

      return {
        envelope: await readFile(SHARE_FILE),
        readImageFile(file) {
          if (!isShareImageFileName(file)) {
            return Promise.reject(new ShareReadError("damaged"));
          }
          return readFile(file);
        },
      };
    },
  };
}
