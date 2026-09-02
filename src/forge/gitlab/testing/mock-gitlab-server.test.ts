import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { commitFiles } from "../../fake/in-memory-git-repo";
import { MockGitLabRepo } from "./mock-gitlab-server";

const TOKEN = "s3cr3t-token";
const PROJECT_URL = `https://gitlab.com/api/v4/projects/${encodeURIComponent("acme/team/notes")}`;

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

async function useSeededMock(): Promise<{
  mock: MockGitLabRepo;
  head: string;
}> {
  const mock = new MockGitLabRepo({
    projectPath: "acme/team/notes",
    token: TOKEN,
  });
  server.use(...mock.handlers());
  const head = await commitFiles(mock.git, {
    parent: null,
    files: { "a.md": "a" },
    message: "init",
    branch: "main",
  });
  return { mock, head };
}

function postCommit(body: unknown): Promise<Response> {
  return fetch(`${PROJECT_URL}/repository/commits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("MockGitLabRepo commits", () => {
  it("rejects start_sha for an existing branch without force", async () => {
    const { head } = await useSeededMock();

    const response = await postCommit({
      branch: "main",
      start_sha: head,
      commit_message: "save",
      actions: [{ action: "create", file_path: "b.md", content: "b" }],
    });

    expect(response.status).toBe(400);
  });

  it("applies a commit without start_sha to the branch's current head", async () => {
    const { mock, head } = await useSeededMock();

    const response = await postCommit({
      branch: "main",
      commit_message: "save",
      actions: [{ action: "create", file_path: "b.md", content: "b" }],
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      parent_ids: string[];
    };
    expect(body.parent_ids).toEqual([head]);
    expect(mock.git.getRef("main")).toBe(body.id);
  });

  it("rejects creating an existing file and updating a missing one", async () => {
    await useSeededMock();

    const create = await postCommit({
      branch: "main",
      commit_message: "save",
      actions: [{ action: "create", file_path: "a.md", content: "x" }],
    });
    const update = await postCommit({
      branch: "main",
      commit_message: "save",
      actions: [{ action: "update", file_path: "missing.md", content: "x" }],
    });

    expect([create.status, update.status]).toEqual([400, 400]);
  });
});

describe("MockGitLabRepo authentication and routing", () => {
  it("returns 401 for a wrong token and 404 for another project", async () => {
    await useSeededMock();

    const wrongToken = await fetch(PROJECT_URL, {
      headers: { Authorization: "Bearer nope" },
    });
    const otherProject = await fetch(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent("acme/other")}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );

    expect([wrongToken.status, otherProject.status]).toEqual([401, 404]);
  });
});
