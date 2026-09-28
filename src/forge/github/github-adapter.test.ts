import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import { isForgeError } from "../errors";
import type { ContentCreatingRequest } from "../forge-adapter";
import { commitFiles } from "../fake/in-memory-git-repo";
import { createForgeAdapter } from "../registry";
import {
  createGitHubAdapter,
  type GitHubAdapterOptions,
} from "./github-adapter";
import { MockGitHubRepo } from "./testing/mock-github-server";

const OWNER = "acme";
const REPO = "notes";
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

function useMock(
  options?: Partial<{ canWrite: boolean; defaultBranch: string }>,
): MockGitHubRepo {
  const mock = new MockGitHubRepo({
    owner: OWNER,
    repo: REPO,
    token: TOKEN,
    ...options,
  });
  server.use(...mock.handlers());
  return mock;
}

function makeAdapter(options?: Partial<GitHubAdapterOptions>): {
  adapter: ReturnType<typeof createGitHubAdapter>;
  reports: ContentCreatingRequest[];
} {
  const reports: ContentCreatingRequest[] = [];
  const adapter = createGitHubAdapter(
    { owner: OWNER, repo: REPO },
    {
      accessToken: TOKEN,
      onContentCreatingRequest: (request) => reports.push(request),
      ...options,
    },
  );
  return { adapter, reports };
}

async function seedConfig(mock: MockGitHubRepo): Promise<string> {
  return commitFiles(mock.git, {
    parent: null,
    files: { [REPO_CONFIG_PATH]: "{}" },
    message: "init",
    branch: MAIN_BRANCH,
  });
}

describe("GitHubAdapter", () => {
  it("inspect reports empty via the 409 empty-repository response", async () => {
    useMock();
    const { adapter } = makeAdapter();
    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });

  it("creates the main ref via POST when the default branch differs", async () => {
    const mock = useMock({ defaultBranch: "master" });
    const { adapter, reports } = makeAdapter();

    const result = await adapter.initialize("{}", "init");
    expect(result.kind).toBe("ok");
    const head = result.kind === "ok" ? result.head : "";

    expect(reports.map((report) => report.operation)).toEqual([
      "initialize",
      "createRef",
    ]);
    expect(mock.requests).toContainEqual({
      method: "POST",
      path: `/repos/${OWNER}/${REPO}/git/refs`,
    });
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(head);
    expect(mock.git.getRef("master")).toBe(head);
  });

  it("returns stale when the update-ref PATCH rejects a non-fast-forward push", async () => {
    const mock = useMock();
    const parent = await seedConfig(mock);
    // Advances main to a sibling of `parent`, so the adapter's own commit
    // (also parented on `parent`) cannot fast-forward it.
    await commitFiles(mock.git, {
      parent,
      files: { "other.md": "other" },
      message: "advance",
      branch: MAIN_BRANCH,
    });

    const { adapter } = makeAdapter();
    const result = await adapter.commit({
      parent,
      changes: [{ kind: "upsert-text", path: "note.md", text: "mine" }],
      message: "save",
    });
    expect(result).toEqual({ kind: "stale" });
  });

  it("maps a 403 with retry-after to RateLimited with that many ms", async () => {
    const mock = useMock();
    await seedConfig(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      { status: 403, headers: { "retry-after": "30" } },
    );

    const { adapter } = makeAdapter();
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "RateLimited",
      retryAfterMs: 30_000,
    });
  });

  it("maps a 403 with x-ratelimit-remaining 0 using x-ratelimit-reset and a fixed now", async () => {
    const mock = useMock();
    await seedConfig(mock);
    const nowMs = 1_700_000_000_000;
    const resetSeconds = Math.floor(nowMs / 1000) + 90;
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetSeconds),
        },
      },
    );

    const { adapter } = makeAdapter({ now: () => nowMs });
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "RateLimited",
      retryAfterMs: 90_000,
    });
  });

  it("maps a headerless 403 secondary-rate-limit message to the default 60s", async () => {
    const mock = useMock();
    await seedConfig(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      {
        status: 403,
        body: { message: "You have exceeded a secondary rate limit" },
      },
    );

    const { adapter } = makeAdapter();
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "RateLimited",
      retryAfterMs: 60_000,
    });
  });

  it("maps a plain 403 to Forbidden", async () => {
    const mock = useMock();
    await seedConfig(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      {
        status: 403,
        body: { message: "Resource not accessible by personal access token" },
      },
    );

    const { adapter } = makeAdapter();
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "Forbidden",
    });
  });

  it("maps 401 to Unauthorized", async () => {
    const mock = useMock();
    await seedConfig(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      { status: 401 },
    );

    const { adapter } = makeAdapter();
    await expect(adapter.getHead()).rejects.toMatchObject({
      kind: "Unauthorized",
    });
  });

  it("maps 500 to Server", async () => {
    const mock = useMock();
    await seedConfig(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      { status: 500 },
    );

    const { adapter } = makeAdapter();
    await expect(adapter.getHead()).rejects.toMatchObject({ kind: "Server" });
  });

  it("maps a network failure to Network, carrying the underlying cause", async () => {
    const mock = useMock();
    await seedConfig(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      { network: true },
    );

    const { adapter } = makeAdapter();
    const error: unknown = await adapter
      .getHead()
      .catch((caught: unknown) => caught);
    expect(isForgeError(error, "Network")).toBe(true);
    if (isForgeError(error, "Network")) {
      expect(error.cause).toBeDefined();
    }
  });

  it("maps a truncated tree response to TreeTruncated", async () => {
    const mock = useMock();
    const commitSha = await commitFiles(mock.git, {
      parent: null,
      files: { "a.md": "x" },
      message: "init",
      branch: MAIN_BRANCH,
    });
    mock.truncateTrees = true;

    const { adapter } = makeAdapter();
    await expect(adapter.listTree(commitSha)).rejects.toMatchObject({
      kind: "TreeTruncated",
    });
  });

  it("caches a blob after the first read, sending no second request", async () => {
    const mock = useMock();
    const commitSha = await commitFiles(mock.git, {
      parent: null,
      files: { "a.md": "hello" },
      message: "init",
      branch: MAIN_BRANCH,
    });

    const { adapter } = makeAdapter();
    const entries = await adapter.listTree(commitSha);
    const entry = entries.find((candidate) => candidate.path === "a.md");
    if (entry === undefined) {
      throw new Error("expected an a.md entry");
    }

    await adapter.readBlob(entry.sha);
    const countAfterFirst = mock.requests.filter((request) =>
      request.path.includes("/git/blobs/"),
    ).length;

    await adapter.readBlob(entry.sha);
    const countAfterSecond = mock.requests.filter((request) =>
      request.path.includes("/git/blobs/"),
    ).length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("sends Authorization, Accept, X-GitHub-Api-Version and cache: no-store on every request", async () => {
    useMock();
    const calls: RequestInit[] = [];
    const capturingFetch: typeof fetch = async (input, init) => {
      calls.push(init ?? {});
      return fetch(input, init);
    };

    const { adapter } = makeAdapter({ fetch: capturingFetch });
    await adapter.inspect();

    expect(calls.length).toBeGreaterThan(0);
    for (const init of calls) {
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers.Accept).toBe("application/vnd.github+json");
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
      expect(init.cache).toBe("no-store");
    }
  });

  it("never places the access token in a request URL", async () => {
    const mock = useMock();
    await seedConfig(mock);

    const { adapter } = makeAdapter();
    await adapter.inspect();
    await adapter.getHead();

    for (const request of mock.requests) {
      expect(request.path).not.toContain(TOKEN);
    }
  });

  it("calls the default fetch without the adapter as receiver", async () => {
    const mock = useMock();
    const head = await seedConfig(mock);

    const original = globalThis.fetch;
    const receiverCheckingFetch = function (
      this: unknown,
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ): ReturnType<typeof fetch> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return original(input, init);
    };
    vi.stubGlobal("fetch", receiverCheckingFetch);

    try {
      const { adapter } = makeAdapter();
      expect(await adapter.getHead()).toBe(head);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("createForgeAdapter builds a working GitHub adapter via the registry", async () => {
    useMock();
    const adapter = createForgeAdapter(
      { forge: "github", owner: OWNER, repo: REPO },
      { accessToken: TOKEN },
    );
    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });
});
