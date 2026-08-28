import type { ForgeProvider, RepositorySummary } from "../forge-provider";
import { createGitHubAdapter } from "./github-adapter";
import { gitHubErrorFor, sendGitHubRequest } from "./github-api";

export interface GitHubProviderOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const TOKEN_CREATION_URL =
  "https://github.com/settings/personal-access-tokens/new";
const MAX_REPOSITORY_PAGES = 10;

interface GitHubRepositoryBody {
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly html_url: string;
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// GitHub token names must be unique per account, hence the date.
function accessTokenCreationUrl(now: Date): string {
  const params = new URLSearchParams({
    name: `commitnote ${localDate(now)}`,
    description:
      "commitnote: reads and saves encrypted notes. Select only your notes repository.",
    expires_in: "365",
    contents: "write",
  });
  return `${TOKEN_CREATION_URL}?${params.toString()}`;
}

function nextPageUrl(response: Response): string | null {
  const link = response.headers.get("link");
  if (link === null) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  return match ? match[1] : null;
}

export function createGitHubProvider(
  options: GitHubProviderOptions = {},
): ForgeProvider {
  const fetchImpl: typeof fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;

  return {
    id: "github",
    name: "GitHub",
    accessTokenCreationUrl,

    async listRepositories(accessToken) {
      const repositories: RepositorySummary[] = [];
      let url: string | null = "/user/repos?per_page=100&sort=full_name";
      for (let page = 0; url !== null && page < MAX_REPOSITORY_PAGES; page++) {
        const response = await sendGitHubRequest(fetchImpl, accessToken, url, {
          method: "GET",
        });
        if (!response.ok) {
          throw await gitHubErrorFor(response, now);
        }
        const body = (await response.json()) as GitHubRepositoryBody[];
        for (const repo of body) {
          repositories.push({
            coordinates: {
              forge: "github",
              owner: repo.owner.login,
              repo: repo.name,
            },
            url: repo.html_url,
          });
        }
        url = nextPageUrl(response);
      }
      return repositories;
    },

    createAdapter(coordinates, adapterOptions) {
      return createGitHubAdapter(coordinates, {
        fetch: fetchImpl,
        now,
        ...adapterOptions,
      });
    },
  };
}
