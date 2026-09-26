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
import type {
  CommitFileChange,
  ContentCreatingRequest,
} from "../forge-adapter";
import { commitFiles } from "../fake/in-memory-git-repo";
import {
  createGitHubAdapter,
  MAX_TREE_REQUEST_BYTES,
  MAX_TREE_REQUEST_ENTRIES,
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

interface TreeRequestBody {
  readonly base_tree: string;
  readonly tree: readonly { readonly path: string }[];
}

function captureTreeRequests(): {
  fetch: typeof fetch;
  treeBodies: TreeRequestBody[];
  treeShas: string[];
} {
  const treeBodies: TreeRequestBody[] = [];
  const treeShas: string[] = [];
  const capturingFetch: typeof fetch = async (input, init) => {
    const isTreePost =
      init?.method === "POST" && String(input).endsWith("/git/trees");
    if (isTreePost) {
      treeBodies.push(JSON.parse(String(init.body)) as TreeRequestBody);
    }
    const response = await fetch(input, init);
    if (isTreePost) {
      treeShas.push(((await response.clone().json()) as { sha: string }).sha);
    }
    return response;
  };
  return { fetch: capturingFetch, treeBodies, treeShas };
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

  it("reports createTree, createCommit, updateRef in order", async () => {
    const mock = useMock();
    const parent = await commitFiles(mock.git, {
      parent: null,
      files: { [REPO_CONFIG_PATH]: "{}", "old.md": "move me" },
      message: "init",
      branch: MAIN_BRANCH,
    });
    const { adapter, reports } = makeAdapter();
    const oldEntry = (await adapter.listTree(parent)).find(
      (entry) => entry.path === "old.md",
    );

    await adapter.commit({
      parent,
      changes: [
        { kind: "upsert-text", path: "a.md", text: "one" },
        { kind: "upsert-text", path: "b.md", text: "two" },
        { kind: "upsert-blob", path: "c.md", blobSha: oldEntry?.sha ?? "" },
        { kind: "delete", path: "old.md" },
      ],
      message: "save",
    });

    expect(reports.map((report) => report.operation)).toEqual([
      "createTree",
      "createCommit",
      "updateRef",
    ]);
  });

  it("sends new text inline in the tree request, including an empty .keep, without creating blobs", async () => {
    const mock = useMock();
    const parent = await seedConfig(mock);
    const { fetch: capturingFetch, treeBodies } = captureTreeRequests();
    const { adapter } = makeAdapter({ fetch: capturingFetch });

    const result = await adapter.commit({
      parent,
      changes: [
        { kind: "upsert-text", path: "note.md", text: "héllo" },
        { kind: "upsert-text", path: "dir/.keep", text: "" },
      ],
      message: "save",
    });

    expect(result.kind).toBe("ok");
    expect(treeBodies).toHaveLength(1);
    expect(treeBodies[0].tree).toEqual([
      { path: "note.md", mode: "100644", type: "blob", content: "héllo" },
      { path: "dir/.keep", mode: "100644", type: "blob", content: "" },
    ]);
    expect(
      mock.requests.some(
        (request) =>
          request.method === "POST" && request.path.endsWith("/git/blobs"),
      ),
    ).toBe(false);
  });

  it("splits a large change set into chained tree requests that end in one commit", async () => {
    const mock = useMock();
    const parent = await seedConfig(mock);
    const parentTree = mock.git.getCommit(parent)?.tree;
    const { fetch: capturingFetch, treeBodies, treeShas } =
      captureTreeRequests();
    const { adapter, reports } = makeAdapter({ fetch: capturingFetch });
    const text = "x".repeat(Math.ceil(MAX_TREE_REQUEST_BYTES / 3));
    const changes: CommitFileChange[] = [
      ...Array.from({ length: 4 }, (_, index) => ({
        kind: "upsert-text" as const,
        path: `big-${index}.md`,
        text,
      })),
      ...Array.from({ length: MAX_TREE_REQUEST_ENTRIES + 1 }, (_, index) => ({
        kind: "upsert-text" as const,
        path: `small/${index}.md`,
        text: `small ${index}`,
      })),
    ];

    const result = await adapter.commit({ parent, changes, message: "bulk" });

    expect(result.kind).toBe("ok");
    const head = result.kind === "ok" ? result.head : "";
    expect(treeBodies.length).toBeGreaterThan(2);
    expect(treeBodies.length + 2).toBe(adapter.commitCost(changes));
    expect(reports).toHaveLength(adapter.commitCost(changes));
    expect(treeBodies.map((body) => body.base_tree)).toEqual([
      parentTree,
      ...treeShas.slice(0, -1),
    ]);
    for (const body of treeBodies) {
      expect(body.tree.length).toBeLessThanOrEqual(MAX_TREE_REQUEST_ENTRIES);
      expect(
        new TextEncoder().encode(JSON.stringify(body.tree)).byteLength,
      ).toBeLessThanOrEqual(MAX_TREE_REQUEST_BYTES + 1_000);
    }
    expect(
      treeBodies.flatMap((body) => body.tree.map((entry) => entry.path)),
    ).toEqual(changes.map((change) => change.path));

    const commit = mock.git.getCommit(head);
    expect(commit?.parent).toBe(parent);
    expect(commit?.tree).toBe(treeShas[treeShas.length - 1]);
    const paths = (await adapter.listTree(head)).map((entry) => entry.path);
    for (const change of changes) {
      expect(paths).toContain(change.path);
    }
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

  describe("ref update outcome", () => {
    const PATCH_REF = { method: "PATCH", pathPattern: /\/git\/refs\/heads\/main$/ };
    const POST_COMMIT = { method: "POST", pathPattern: /\/git\/commits$/ };
    const request = (parent: string) => ({
      parent,
      changes: [{ kind: "upsert-text", path: "note.md", text: "mine" }] as CommitFileChange[],
      message: "save",
    });

    it("reports a ref update whose response was lost but which applied", async () => {
      const mock = useMock();
      const parent = await seedConfig(mock);
      mock.dropNextResponse(PATCH_REF);

      const result = await makeAdapter().adapter.commit(request(parent));

      expect(result).toEqual({ kind: "ok", head: mock.git.getRef(MAIN_BRANCH) });
      expect(mock.git.getRef(MAIN_BRANCH)).not.toBe(parent);
    });

    it("marks a lost ref update that did not apply as leaving main unchanged", async () => {
      const mock = useMock();
      const parent = await seedConfig(mock);
      mock.failNext(PATCH_REF, { network: true });

      await expect(
        makeAdapter().adapter.commit(request(parent)),
      ).rejects.toMatchObject({ kind: "Network", mainUnchanged: true });
      expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
    });

    it("marks failures before the ref update as leaving main unchanged", async () => {
      const mock = useMock();
      const parent = await seedConfig(mock);
      mock.failNext(POST_COMMIT, { network: true });

      await expect(
        makeAdapter().adapter.commit(request(parent)),
      ).rejects.toMatchObject({ kind: "Network", mainUnchanged: true });
    });
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

});
