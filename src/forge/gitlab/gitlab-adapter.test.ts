import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import { commitFiles } from "../fake/in-memory-git-repo";
import { createGitLabAdapter, MAX_TREE_PAGES } from "./gitlab-adapter";
import type { GitLabAdapterOptions } from "./gitlab-adapter";
import { MockGitLabRepo } from "./testing/mock-gitlab-server";
import { argon2idDirect } from "../../crypto/argon2";
import { initializeNotesRepo, inspectRepository } from "../../login/login";
import { useMswServer } from "../fake/msw-test-server";

const PROJECT = "acme/team/notes";
const TOKEN = "s3cr3t-token";

const getServer = useMswServer();

function useMock(options?: { canWrite?: boolean }): MockGitLabRepo {
  const mock = new MockGitLabRepo({
    projectPath: PROJECT,
    token: TOKEN,
    ...options,
  });
  getServer().use(...mock.handlers());
  return mock;
}

function makeAdapter(options?: Partial<GitLabAdapterOptions>) {
  return createGitLabAdapter(
    { owner: "acme/team", repo: "notes" },
    { accessToken: TOKEN, ...options },
  );
}

function seed(
  mock: MockGitLabRepo,
  files: Record<string, string> = {},
): Promise<string> {
  return commitFiles(mock.git, {
    parent: null,
    files: { [REPO_CONFIG_PATH]: "{}", ...files },
    message: "init",
    branch: MAIN_BRANCH,
  });
}

async function pushFromAnotherDevice(
  mock: MockGitLabRepo,
  path: string,
  text: string,
): Promise<string> {
  const parent = mock.git.getRef(MAIN_BRANCH) ?? null;
  const tree =
    parent === null ? null : (mock.git.getCommit(parent)?.tree ?? null);
  const sha = await mock.git.putCommit({
    tree: await mock.git.applyChanges(tree, [
      { kind: "upsert-text", path, text },
    ]),
    parent,
    message: "elsewhere",
  });
  mock.git.setRef(MAIN_BRANCH, sha);
  return sha;
}

// Lets another device commit right before the adapter's commit request
// reaches the mock, i.e. after the adapter's own head check.
function raceNextCommit(action: () => Promise<unknown>): void {
  getServer().use(
    http.post(
      /\/repository\/commits$/,
      async () => {
        await action();
        return undefined;
      },
      { once: true },
    ),
  );
}

function captureCommitBodies(): unknown[] {
  const bodies: unknown[] = [];
  getServer().use(
    http.post(/\/repository\/commits$/, async ({ request }) => {
      bodies.push(await request.clone().json());
      return undefined;
    }),
  );
  return bodies;
}

describe("GitLabAdapter", () => {
  it("returns stale when a concurrent commit touched the same file after the head check", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    raceNextCommit(() => pushFromAnotherDevice(mock, "note.md", "theirs"));

    const result = await makeAdapter().commit({
      parent,
      changes: [{ kind: "upsert-text", path: "note.md", text: "mine" }],
      message: "save",
    });

    expect(result).toEqual({ kind: "stale" });
    const head = mock.git.getRef(MAIN_BRANCH) ?? "";
    const tree = mock.git.getTree(mock.git.getCommit(head)?.tree ?? "");
    expect(mock.git.getBlob(tree?.get("note.md") ?? "")).toBe("theirs");
  });

  it("rejects with Server when the commit landed on a head that moved after the head check", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    raceNextCommit(() => pushFromAnotherDevice(mock, "other.md", "theirs"));

    await expect(
      makeAdapter().commit({
        parent,
        changes: [{ kind: "upsert-text", path: "note.md", text: "mine" }],
        message: "save",
      }),
    ).rejects.toMatchObject({ kind: "Server" });
  });

  it("commits on main without start_sha or force, creating new files and updating existing ones", async () => {
    const mock = useMock();
    const parent = await seed(mock, { "existing.md": "old" });
    const bodies = captureCommitBodies();

    await makeAdapter().commit({
      parent,
      changes: [
        { kind: "upsert-text", path: "existing.md", text: "new" },
        { kind: "upsert-text", path: "fresh.md", text: "hello" },
      ],
      message: "save",
    });

    expect(bodies).toEqual([
      {
        branch: MAIN_BRANCH,
        commit_message: "save",
        actions: [
          {
            action: "update",
            file_path: "existing.md",
            content: "new",
            encoding: "text",
          },
          {
            action: "create",
            file_path: "fresh.md",
            content: "hello",
            encoding: "text",
          },
        ],
      },
    ]);
  });

  it("sends a moved blob as a move action without fetching its content", async () => {
    const mock = useMock();
    const parent = await seed(mock, { "old.md": "keep me" });
    const adapter = makeAdapter();
    const oldSha =
      (await adapter.listTree(parent)).find((entry) => entry.path === "old.md")
        ?.sha ?? "";
    const bodies = captureCommitBodies();

    await adapter.commit({
      parent,
      changes: [
        { kind: "upsert-blob", path: "new.md", blobSha: oldSha },
        { kind: "delete", path: "old.md" },
      ],
      message: "move",
    });

    expect(bodies).toMatchObject([
      {
        actions: [
          { action: "move", file_path: "new.md", previous_path: "old.md" },
        ],
      },
    ]);
    expect(
      mock.requests.some((request) => request.path.includes("/blobs/")),
    ).toBe(false);
  });

  it("uploads a reused blob's bytes as base64 when no file of it is deleted", async () => {
    const mock = useMock();
    const parent = await seed(mock, { "source.md": "héllo" });
    const adapter = makeAdapter();
    const sourceSha =
      (await adapter.listTree(parent)).find(
        (entry) => entry.path === "source.md",
      )?.sha ?? "";
    const bodies = captureCommitBodies();

    const result = await adapter.commit({
      parent,
      changes: [{ kind: "upsert-blob", path: "copy.md", blobSha: sourceSha }],
      message: "copy",
    });

    expect(bodies).toMatchObject([
      {
        actions: [
          {
            action: "create",
            file_path: "copy.md",
            content: "aMOpbGxv",
            encoding: "base64",
          },
        ],
      },
    ]);
    const head = result.kind === "ok" ? result.head : "";
    const copy = (await adapter.listTree(head)).find(
      (entry) => entry.path === "copy.md",
    );
    expect(copy?.sha).toBe(sourceSha);
  });

  it("reports canWrite false when main is protected against the user's pushes", async () => {
    const mock = useMock();
    const head = await seed(mock);
    getServer().use(
      http.get(/\/repository\/branches\/main$/, () =>
        HttpResponse.json({
          name: MAIN_BRANCH,
          commit: { id: head },
          can_push: false,
        }),
      ),
    );

    expect(await makeAdapter().inspect()).toMatchObject({
      kind: "populated",
      canWrite: false,
    });
  });

  it("grants write access through an inherited group membership", async () => {
    useMock();
    getServer().use(
      http.get(/\/projects\/[^/]+$/, () =>
        HttpResponse.json({
          empty_repo: true,
          permissions: {
            project_access: null,
            group_access: { access_level: 40 },
          },
        }),
      ),
    );

    expect(await makeAdapter().inspect()).toEqual({
      kind: "empty",
      canWrite: true,
    });
  });

  it("returns stale from initialize when another client populated the repository first", async () => {
    const mock = useMock();
    raceNextCommit(() => seed(mock));

    expect(await makeAdapter().initialize("{}", "init")).toEqual({
      kind: "stale",
    });
  });

  it("adds a repo config to a README-only project with a plain commit while atomic commits need setup", async () => {
    const mock = useMock();
    const parent = await commitFiles(mock.git, {
      parent: null,
      files: { "README.md": "# notes\n" },
      message: "Initial commit",
      branch: MAIN_BRANCH,
    });
    const adapter = makeAdapter();
    expect(await adapter.atomicCommitSupport?.()).toMatchObject({
      kind: "needsSetup",
    });

    const result = await adapter.commit({
      parent,
      changes: [{ kind: "upsert-text", path: REPO_CONFIG_PATH, text: "{}" }],
      message: "init",
    });

    expect(result.kind).toBe("ok");
    const head = mock.git.getRef(MAIN_BRANCH) ?? "";
    expect(mock.git.getCommit(head)?.parent).toBe(parent);
    const tree = mock.git.getTree(mock.git.getCommit(head)?.tree ?? "");
    expect([...(tree?.keys() ?? [])].sort()).toEqual(
      [REPO_CONFIG_PATH, "README.md"].sort(),
    );
    expect(
      mock.requests.some((request) => request.path.includes("merge_requests")),
    ).toBe(false);
  });

  it("setting up a README-only project reports initializationRaced, then a notes repo, when an unrelated commit lands after the head check", async () => {
    const mock = useMock();
    await commitFiles(mock.git, {
      parent: null,
      files: { "README.md": "# notes\n" },
      message: "Initial commit",
      branch: MAIN_BRANCH,
    });
    const adapter = makeAdapter();
    const deps = { createAdapter: () => adapter, argon2id: argon2idDirect };
    const repository = {
      coordinates: { forge: "gitlab", owner: "acme/team", repo: "notes" },
      url: "https://gitlab.com/acme/team/notes",
      private: true,
    } as const;
    const state = await inspectRepository(repository, TOKEN, deps);
    if (state.kind !== "uninitialized") throw new Error("expected uninitialized");
    raceNextCommit(() => pushFromAnotherDevice(mock, "other.md", "theirs"));

    const result = await initializeNotesRepo(state.pending, "pass", deps);

    expect(result).toEqual({
      kind: "failed",
      error: { kind: "initializationRaced" },
    });
    expect((await inspectRepository(repository, TOKEN, deps)).kind).toBe(
      "notesRepo",
    );
  });

  it("follows tree pagination across pages", async () => {
    const mock = useMock();
    const head = await seed(mock, {
      "a.md": "a",
      "b.md": "b",
      "dir/c.md": "c",
    });
    mock.treePageSize = 2;

    const paths = (await makeAdapter().listTree(head)).map(
      (entry) => entry.path,
    );

    expect(paths).toEqual([
      ".commitnote",
      REPO_CONFIG_PATH,
      "a.md",
      "b.md",
      "dir",
      "dir/c.md",
    ]);
  });

  it("maps a tree with more pages than the cap to TreeTruncated", async () => {
    const mock = useMock();
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_TREE_PAGES; i++) files[`n${i}.md`] = String(i);
    const head = await seed(mock, files);
    mock.treePageSize = 1;

    await expect(makeAdapter().listTree(head)).rejects.toMatchObject({
      kind: "TreeTruncated",
    });
  });

  it("maps a 403 with RateLimit-Remaining 0 to RateLimited using RateLimit-Reset", async () => {
    const mock = useMock();
    await seed(mock);
    mock.failNext(
      { method: "GET", pathPattern: /\/repository\/branches\/main$/ },
      {
        status: 403,
        headers: { "ratelimit-remaining": "0", "ratelimit-reset": "1030" },
      },
    );

    await expect(
      makeAdapter({ now: () => 1_000_000 }).getHead(),
    ).rejects.toMatchObject({ kind: "RateLimited", retryAfterMs: 30_000 });
  });

  it("keeps GitLab's error text, which may quote paths, out of errors", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.failNext(
      { method: "POST", pathPattern: /\/repository\/commits$/ },
      { status: 500, body: { message: "failed on secret-name.md" } },
    );

    const error: unknown = await makeAdapter()
      .commit({
        parent,
        changes: [{ kind: "upsert-text", path: "secret-name.md", text: "x" }],
        message: "save",
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: "Server" });
    expect(String((error as Error).message)).not.toContain("secret-name");
  });

  it("sends only Authorization, plus Content-Type on bodies, with cache no-store", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    const calls: RequestInit[] = [];
    const capturingFetch: typeof fetch = async (input, init) => {
      calls.push(init ?? {});
      return fetch(input, init);
    };

    const adapter = makeAdapter({ fetch: capturingFetch });
    await adapter.inspect();
    await adapter.commit({
      parent,
      changes: [{ kind: "upsert-text", path: "note.md", text: "x" }],
      message: "save",
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const init of calls) {
      const headers = init.headers as Record<string, string>;
      const expected =
        init.body === undefined
          ? { Authorization: `Bearer ${TOKEN}` }
          : {
              Authorization: `Bearer ${TOKEN}`,
              "Content-Type": "application/json",
            };
      expect(headers).toEqual(expected);
      expect(init.cache).toBe("no-store");
    }
  });
});

describe("GitLabAdapter history", () => {
  it("lists commits by ref_name and path, mapping ids, parents and dates", async () => {
    const mock = useMock();
    const first = await seed(mock, { "dir/a b.md": "one" });
    mock.setCommitDate(first, new Date("2026-03-01T10:00:00.000Z"));
    const second = await pushFromAnotherDevice(mock, "dir/a b.md", "two");
    mock.setCommitDate(second, new Date("2026-03-01T10:05:00.000Z"));

    const commits = await makeAdapter().listCommits({
      from: second,
      path: "dir/a b.md",
      limit: 50,
    });

    expect(commits).toEqual([
      {
        sha: second,
        parents: [first],
        message: "elsewhere",
        committedAt: Date.parse("2026-03-01T10:05:00.000Z"),
      },
      {
        sha: first,
        parents: [],
        message: "init",
        committedAt: Date.parse("2026-03-01T10:00:00.000Z"),
      },
    ]);
    const listing = mock.requests.find((request) =>
      request.path.includes("/repository/commits?"),
    );
    expect(
      Object.fromEntries(new URL(listing?.path ?? "", "https://x").searchParams),
    ).toEqual({
      ref_name: second,
      path: "dir/a b.md",
      per_page: "50",
      page: "1",
    });
  });

  it("checks that `from` exists when the listing comes back empty", async () => {
    const mock = useMock();
    const head = await seed(mock);
    const adapter = makeAdapter();

    expect(
      await adapter.listCommits({ from: head, path: "missing.md", limit: 5 }),
    ).toEqual([]);
    await expect(
      adapter.listCommits({ from: "0".repeat(40), path: "a.md", limit: 5 }),
    ).rejects.toMatchObject({ kind: "NotFound" });
    expect(
      mock.requests.filter((request) =>
        /\/repository\/commits\/[^/?]+$/.test(request.path),
      ),
    ).toHaveLength(2);
  });

  describe("findOldestCommit", () => {
    async function pushMany(
      mock: MockGitLabRepo,
      path: string,
      count: number,
    ): Promise<string[]> {
      const shas: string[] = [];
      for (let index = 0; index < count; index++) {
        shas.push(await pushFromAnotherDevice(mock, path, `text ${index}`));
      }
      return shas;
    }

    function listingRequests(mock: MockGitLabRepo) {
      return mock.requests.filter((request) =>
        request.path.includes("/repository/commits?"),
      );
    }

    it("reads the last page of a one-per-page listing, in two requests", async () => {
      const mock = useMock();
      const first = await seed(mock, { "a.md": "seed" });
      const shas = await pushMany(mock, "a.md", 5);

      const oldest = await makeAdapter().findOldestCommit({
        from: shas[4],
        path: "a.md",
      });

      expect(oldest).toMatchObject({ sha: first, parents: [] });
      const listings = listingRequests(mock);
      expect(listings).toHaveLength(2);
      expect(
        listings.map((request) =>
          Object.fromEntries(new URL(request.path, "https://x").searchParams),
        ),
      ).toEqual([
        { ref_name: shas[4], path: "a.md", per_page: "1", page: "1" },
        { ref_name: shas[4], path: "a.md", per_page: "1", page: "6" },
      ]);
    });

    it("answers from the first response when there is a single commit", async () => {
      const mock = useMock();
      const head = await seed(mock, { "a.md": "one" });

      const oldest = await makeAdapter().findOldestCommit({
        from: head,
        path: "a.md",
      });

      expect(oldest).toMatchObject({ sha: head, parents: [] });
      expect(listingRequests(mock)).toHaveLength(1);
    });

    it("returns null when no commit touches the path", async () => {
      const mock = useMock();
      const head = await seed(mock);

      expect(
        await makeAdapter().findOldestCommit({ from: head, path: "none.md" }),
      ).toBeNull();
    });

    it("rejects an unknown ref with NotFound", async () => {
      const mock = useMock();
      await seed(mock);

      await expect(
        makeAdapter().findOldestCommit({ from: "0".repeat(40), path: "a.md" }),
      ).rejects.toMatchObject({ kind: "NotFound" });
    });

    it("pages forward at 100 per page when the server sends no totals", async () => {
      const mock = useMock();
      mock.omitTotals = true;
      const first = await seed(mock, { "a.md": "seed" });
      const shas = await pushMany(mock, "a.md", 149);

      const oldest = await makeAdapter().findOldestCommit({
        from: shas[148],
        path: "a.md",
      });

      expect(oldest?.sha).toBe(first);
      const pages = listingRequests(mock).map((request) =>
        new URL(request.path, "https://x").searchParams.get("per_page"),
      );
      expect(pages).toEqual(["1", "100", "100"]);
    });

    it("maps a rate-limited listing to RateLimited", async () => {
      const mock = useMock();
      const head = await seed(mock, { "a.md": "one" });
      mock.failNext(
        { method: "GET", pathPattern: /\/repository\/commits\?/ },
        {
          status: 429,
          headers: { "retry-after": "7" },
        },
      );

      await expect(
        makeAdapter().findOldestCommit({ from: head, path: "a.md" }),
      ).rejects.toMatchObject({ kind: "RateLimited", retryAfterMs: 7000 });
    });
  });

  it("reads a file at a commit with its whole path encoded and caches its blob", async () => {
    const mock = useMock();
    const head = await seed(mock, { "dir/ü n.md": "héllo" });
    const adapter = makeAdapter();

    const file = await adapter.readFileAt(head, "dir/ü n.md");
    expect(file?.text).toBe("héllo");
    await adapter.readBlob(file?.blobSha ?? "");

    expect(mock.requests.map((request) => request.path)).toEqual([
      `/api/v4/projects/${encodeURIComponent(PROJECT)}/repository/files/dir%2F%C3%BC%20n.md?ref=${head}`,
    ]);
  });
});
