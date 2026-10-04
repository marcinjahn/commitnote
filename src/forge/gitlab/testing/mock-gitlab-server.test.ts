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

describe("MockGitLabRepo commit list pagination", () => {
  async function listHeaders(head: string, page: number): Promise<Headers> {
    const response = await fetch(
      `${PROJECT_URL}/repository/commits?ref_name=${head}&path=a.md&per_page=1&page=${page}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    return response.headers;
  }

  async function seedThree(): Promise<{ mock: MockGitLabRepo; head: string }> {
    const { mock, head } = await useSeededMock();
    const second = await commitFiles(mock.git, {
      parent: head,
      files: { "a.md": "b" },
      message: "second",
      branch: "main",
    });
    const third = await commitFiles(mock.git, {
      parent: second,
      files: { "a.md": "c" },
      message: "third",
      branch: "main",
    });
    return { mock, head: third };
  }

  it("reports page counters and totals", async () => {
    const { head } = await seedThree();

    const middle = await listHeaders(head, 2);
    const last = await listHeaders(head, 3);

    expect(Object.fromEntries(middle)).toMatchObject({
      "x-page": "2",
      "x-per-page": "1",
      "x-total": "3",
      "x-total-pages": "3",
      "x-next-page": "3",
      "x-prev-page": "1",
    });
    expect(last.get("x-next-page")).toBe("");
  });

  it("omits the totals but keeps the page counters with omitTotals", async () => {
    const { mock, head } = await seedThree();
    mock.omitTotals = true;

    const headers = await listHeaders(head, 1);

    expect(headers.has("x-total")).toBe(false);
    expect(headers.has("x-total-pages")).toBe(false);
    expect(headers.get("x-next-page")).toBe("2");
  });
});
