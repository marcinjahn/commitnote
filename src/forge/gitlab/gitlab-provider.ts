import type { ForgeProvider, RepositorySummary } from "../forge-provider";
import { createGitLabAdapter } from "./gitlab-adapter";
import { gitLabErrorFor, nextPageUrl, sendGitLabRequest } from "./gitlab-api";

export interface GitLabProviderOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const TOKEN_CREATION_URL =
  "https://gitlab.com/-/user_settings/personal_access_tokens";
const MAX_REPOSITORY_PAGES = 10;

interface GitLabProjectBody {
  readonly path_with_namespace: string;
  readonly web_url: string;
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// The `api` scope is the narrowest one that allows creating commits through
// the REST API. GitLab has no URL parameter for the expiry; its form
// defaults to a year.
function accessTokenCreationUrl(now: Date): string {
  const params = new URLSearchParams({
    name: `commitnote ${localDate(now)}`,
    description: "commitnote: reads and saves encrypted notes.",
    scopes: "api",
  });
  return `${TOKEN_CREATION_URL}?${params.toString()}`;
}

// Nested groups are kept whole in the owner: "group/sub/project" becomes
// owner "group/sub", repo "project".
function splitProjectPath(pathWithNamespace: string): {
  owner: string;
  repo: string;
} {
  const slash = pathWithNamespace.lastIndexOf("/");
  return {
    owner: pathWithNamespace.slice(0, slash),
    repo: pathWithNamespace.slice(slash + 1),
  };
}

export function createGitLabProvider(
  options: GitLabProviderOptions = {},
): ForgeProvider {
  const fetchImpl: typeof fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;

  return {
    id: "gitlab",
    name: "GitLab",
    accessTokenHint:
      "A personal access token with the api scope, which GitLab's commit API requires.",
    accessTokenCreationUrl,

    async listRepositories(accessToken) {
      const repositories: RepositorySummary[] = [];
      let url: string | null =
        "/projects?membership=true&simple=true&per_page=100&order_by=path&sort=asc";
      for (let page = 0; url !== null && page < MAX_REPOSITORY_PAGES; page++) {
        const response = await sendGitLabRequest(fetchImpl, accessToken, url, {
          method: "GET",
        });
        if (!response.ok) {
          throw gitLabErrorFor(response, now);
        }
        const body = (await response.json()) as GitLabProjectBody[];
        for (const project of body) {
          repositories.push({
            coordinates: {
              forge: "gitlab",
              ...splitProjectPath(project.path_with_namespace),
            },
            url: project.web_url,
          });
        }
        url = nextPageUrl(response, url);
      }
      return repositories;
    },

    createAdapter(coordinates, adapterOptions) {
      return createGitLabAdapter(coordinates, {
        fetch: fetchImpl,
        now,
        ...adapterOptions,
      });
    },
  };
}
