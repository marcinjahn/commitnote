import { defaultFetch, localDateStamp } from "../forge-http";
import type { ForgeProvider, RepositorySummary } from "../forge-provider";
import { parseLinkHeader } from "../link-header";
import { createGitHubAdapter } from "./github-adapter";
import { gitHubErrorFor, sendGitHubRequest } from "./github-api";

export interface GitHubProviderOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const TOKEN_CREATION_URL =
  "https://github.com/settings/personal-access-tokens/new";
const REPOSITORY_CREATION_URL =
  "https://github.com/new?name=notes&visibility=private";
const MAX_REPOSITORY_PAGES = 10;

interface GitHubRepositoryBody {
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly html_url: string;
  readonly private: boolean;
}

// GitHub token names must be unique per account, hence the date.
function accessTokenCreationUrl(now: Date): string {
  const params = new URLSearchParams({
    name: `commitnote ${localDateStamp(now)}`,
    description:
      "commitnote: reads and saves encrypted notes. Select only your notes repository.",
    expires_in: "365",
    contents: "write",
  });
  return `${TOKEN_CREATION_URL}?${params.toString()}`;
}

export function createGitHubProvider(
  options: GitHubProviderOptions = {},
): ForgeProvider {
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;

  return {
    id: "github",
    name: "GitHub",
    accessTokenHint:
      'A fine-grained token for your notes repository only, with "Contents: read and write".',
    accessTokenCreationUrl,
    repositoryCreationUrl: () => REPOSITORY_CREATION_URL,

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
            private: repo.private,
          });
        }
        url = parseLinkHeader(response.headers.get("link")).get("next") ?? null;
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
