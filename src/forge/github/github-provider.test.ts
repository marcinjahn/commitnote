import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { ForgeError } from "../errors";
import { adapterFactoryFor, forgeRegistry } from "../registry";
import { createGitHubProvider } from "./github-provider";
import { MockGitHubRepo } from "./testing/mock-github-server";

const TOKEN = "s3cr3t-token";

let server: SetupServer;

beforeAll(() => {
  server = setupServer();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function repoBody(owner: string, name: string) {
  return {
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    html_url: `https://github.com/${owner}/${name}`,
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
    expect(url.searchParams.get("expires_in")).toBe("366");
  });

  it("lists repositories across pages, authenticated with the token", async () => {
    const authorizations: (string | null)[] = [];
    server.use(
      http.get("https://api.github.com/user/repos", ({ request }) => {
        authorizations.push(request.headers.get("authorization"));
        const page = new URL(request.url).searchParams.get("page");
        if (page === "2") {
          return HttpResponse.json([repoBody("acme", "notes")]);
        }
        return HttpResponse.json(
          [repoBody("alice", "notes"), repoBody("alice", "work")],
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
      },
      {
        coordinates: { forge: "github", owner: "alice", repo: "work" },
        url: "https://github.com/alice/work",
      },
      {
        coordinates: { forge: "github", owner: "acme", repo: "notes" },
        url: "https://github.com/acme/notes",
      },
    ]);
    expect(authorizations).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it("throws an Unauthorized ForgeError for a rejected token", async () => {
    server.use(
      http.get("https://api.github.com/user/repos", () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );

    const listing = createGitHubProvider().listRepositories("bad");

    await expect(listing).rejects.toBeInstanceOf(ForgeError);
    await expect(listing).rejects.toMatchObject({ kind: "Unauthorized" });
  });

  it("throws a Network ForgeError when the request fails", async () => {
    server.use(
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
    server.use(...mock.handlers());

    const adapter = adapterFactoryFor(forgeRegistry)(
      { forge: "github", owner: "acme", repo: "notes" },
      { accessToken: TOKEN },
    );

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });
});
