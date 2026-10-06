import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { ForgeError } from "../errors";
import { adapterFactoryFor, forgeRegistry } from "../registry";
import { createGitHubProvider } from "./github-provider";
import { MockGitHubRepo } from "./testing/mock-github-server";
import { useMswServer } from "../fake/msw-test-server";

const TOKEN = "s3cr3t-token";

const getServer = useMswServer();

function repoBody(owner: string, name: string, isPrivate = true) {
  return {
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    html_url: `https://github.com/${owner}/${name}`,
    private: isPrivate,
  };
}

describe("GitHub provider", () => {
  it("builds a token creation URL with the needed permission and a dated name", () => {
    const url = new URL(
      createGitHubProvider().accessTokenCreationUrl(
        new Date(2026, 8, 30, 23, 30),
      ),
    );

    expect(url.origin + url.pathname).toBe(
      "https://github.com/settings/personal-access-tokens/new",
    );
    expect(url.searchParams.get("name")).toBe("commitnote 2026-09-30");
    expect(url.searchParams.get("contents")).toBe("write");
    expect(url.searchParams.get("gists")).toBe("write");
    expect(url.searchParams.get("expires_in")).toBe("365");
  });

  it("links to creating a private repository named notes", () => {
    const url = new URL(createGitHubProvider().repositoryCreationUrl());

    expect(url.origin + url.pathname).toBe("https://github.com/new");
    expect(url.searchParams.get("name")).toBe("notes");
    expect(url.searchParams.get("visibility")).toBe("private");
  });

  it("lists repositories across pages, authenticated with the token", async () => {
    const authorizations: (string | null)[] = [];
    getServer().use(
      http.get("https://api.github.com/user/repos", ({ request }) => {
        authorizations.push(request.headers.get("authorization"));
        const page = new URL(request.url).searchParams.get("page");
        if (page === "2") {
          return HttpResponse.json([repoBody("acme", "notes")]);
        }
        return HttpResponse.json(
          [repoBody("alice", "notes"), repoBody("alice", "work", false)],
          {
            headers: {
              link: '<https://api.github.com/user/repos?per_page=100&page=2>; rel="next", <https://api.github.com/user/repos?per_page=100&page=2>; rel="last"',
            },
          },
        );
      }),
    );

    const repositories =
      await createGitHubProvider().listRepositories(TOKEN);

    expect(repositories).toEqual([
      {
        coordinates: { forge: "github", owner: "alice", repo: "notes" },
        url: "https://github.com/alice/notes",
        private: true,
      },
      {
        coordinates: { forge: "github", owner: "alice", repo: "work" },
        url: "https://github.com/alice/work",
        private: false,
      },
      {
        coordinates: { forge: "github", owner: "acme", repo: "notes" },
        url: "https://github.com/acme/notes",
        private: true,
      },
    ]);
    expect(authorizations).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it("throws an Unauthorized ForgeError for a rejected token", async () => {
    getServer().use(
      http.get("https://api.github.com/user/repos", () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );

    const listing = createGitHubProvider().listRepositories("bad");

    await expect(listing).rejects.toBeInstanceOf(ForgeError);
    await expect(listing).rejects.toMatchObject({ kind: "Unauthorized" });
  });

  it("throws a Network ForgeError when the request fails", async () => {
    getServer().use(
      http.get("https://api.github.com/user/repos", () => HttpResponse.error()),
    );

    await expect(
      createGitHubProvider().listRepositories(TOKEN),
    ).rejects.toMatchObject({ kind: "Network" });
  });

  it("builds a working GitHub adapter via the registry", async () => {
    const mock = new MockGitHubRepo({
      owner: "acme",
      repo: "notes",
      token: TOKEN,
    });
    getServer().use(...mock.handlers());

    const adapter = adapterFactoryFor(forgeRegistry)(
      { forge: "github", owner: "acme", repo: "notes" },
      { accessToken: TOKEN },
    );

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });
});
