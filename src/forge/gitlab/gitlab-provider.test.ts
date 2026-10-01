import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { adapterFactoryFor, forgeRegistry } from "../registry";
import { createGitLabProvider } from "./gitlab-provider";
import { MockGitLabRepo } from "./testing/mock-gitlab-server";

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

function projectBody(pathWithNamespace: string, visibility = "private") {
  return {
    path_with_namespace: pathWithNamespace,
    web_url: `https://gitlab.com/${pathWithNamespace}`,
    visibility,
  };
}

describe("GitLab provider", () => {
  it("builds a token creation URL with the api scope and a dated name", () => {
    const url = new URL(
      createGitLabProvider().accessTokenCreationUrl(
        new Date(2026, 8, 30, 23, 30),
      ),
    );

    expect(url.origin + url.pathname).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    );
    expect(url.searchParams.get("name")).toBe("commitnote 2026-09-30");
    expect(url.searchParams.get("scopes")).toBe("api");
  });

  it("links to creating a blank project", () => {
    expect(createGitLabProvider().repositoryCreationUrl()).toBe(
      "https://gitlab.com/projects/new#blank_project",
    );
  });

  it("lists member projects across Link and x-next-page pages, keeping nested groups in the owner", async () => {
    const requests: { authorization: string | null; search: string }[] = [];
    server.use(
      http.get("https://gitlab.com/api/v4/projects", ({ request }) => {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          search: url.search,
        });
        const page = url.searchParams.get("page");
        if (page === null) {
          return HttpResponse.json([projectBody("alice/notes")], {
            headers: {
              link: '<https://gitlab.com/api/v4/projects?membership=true&page=2>; rel="next"',
            },
          });
        }
        if (page === "2") {
          return HttpResponse.json([projectBody("acme/team/notes", "internal")], {
            headers: { "x-next-page": "3" },
          });
        }
        return HttpResponse.json([projectBody("bob/notes", "public")], {
          headers: { "x-next-page": "" },
        });
      }),
    );

    const repositories = await createGitLabProvider().listRepositories(TOKEN);

    expect(repositories).toEqual([
      {
        coordinates: { forge: "gitlab", owner: "alice", repo: "notes" },
        url: "https://gitlab.com/alice/notes",
        private: true,
      },
      {
        coordinates: { forge: "gitlab", owner: "acme/team", repo: "notes" },
        url: "https://gitlab.com/acme/team/notes",
        private: false,
      },
      {
        coordinates: { forge: "gitlab", owner: "bob", repo: "notes" },
        url: "https://gitlab.com/bob/notes",
        private: false,
      },
    ]);
    expect(new URLSearchParams(requests[0].search).get("membership")).toBe(
      "true",
    );
    expect(requests.map((request) => request.authorization)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
  });

  it("throws an Unauthorized ForgeError for a rejected token", async () => {
    server.use(
      http.get("https://gitlab.com/api/v4/projects", () =>
        HttpResponse.json({ message: "401 Unauthorized" }, { status: 401 }),
      ),
    );

    await expect(
      createGitLabProvider().listRepositories("bad"),
    ).rejects.toMatchObject({ kind: "Unauthorized" });
  });

  it("builds a working GitLab adapter for a nested project via the registry", async () => {
    const mock = new MockGitLabRepo({
      projectPath: "acme/team/notes",
      token: TOKEN,
    });
    server.use(...mock.handlers());

    const adapter = adapterFactoryFor(forgeRegistry)(
      { forge: "gitlab", owner: "acme/team", repo: "notes" },
      { accessToken: TOKEN },
    );

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });
});
