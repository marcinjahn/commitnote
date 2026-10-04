import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { commitFiles } from "../../fake/in-memory-git-repo";
import {
  MockGitHubRepo,
  type MockGitHubRepoOptions,
} from "./mock-github-server";

const OWNER = "acme";
const REPO = "notes";
const TOKEN = "s3cr3t-token";
const BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

function authHeaders(token: string = TOKEN): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

function decodeWrappedBase64(wrapped: string): string {
  const clean = wrapped.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

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
  options?: Partial<Omit<MockGitHubRepoOptions, "owner" | "repo" | "token">>,
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

async function putFirstFile(
  path: string,
  text: string,
  branch?: string,
): Promise<{ commitSha: string; blobSha: string }> {
  const res = await fetch(`${BASE}/contents/${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      message: "init",
      content: btoa(text),
      ...(branch === undefined ? {} : { branch }),
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    content: { sha: string };
    commit: { sha: string };
  };
  return { commitSha: body.commit.sha, blobSha: body.content.sha };
}

describe("MockGitHubRepo authentication and routing", () => {
  it("returns 401 Bad credentials for a missing or wrong token", async () => {
    useMock();
    const res = await fetch(`${BASE}`, { headers: authHeaders("wrong") });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Bad credentials" });

    const missing = await fetch(`${BASE}`, {
      headers: { accept: "application/vnd.github+json" },
    });
    expect(missing.status).toBe(401);
  });

  it("returns 404 Not Found for a different owner or repo", async () => {
    useMock();
    const res = await fetch("https://api.github.com/repos/someone-else/other", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Not Found" });
  });

  it("records every request received, path included", async () => {
    const mock = useMock();
    await fetch(`${BASE}/git/ref/heads/main`, { headers: authHeaders() });
    expect(mock.requests).toContainEqual({
      method: "GET",
      path: `/repos/${OWNER}/${REPO}/git/ref/heads/main`,
    });
  });
});

describe("MockGitHubRepo empty repository", () => {
  it("returns 409 on Git Data endpoints", async () => {
    useMock();

    const ref = await fetch(`${BASE}/git/ref/heads/main`, {
      headers: authHeaders(),
    });
    expect(ref.status).toBe(409);
    expect(await ref.json()).toEqual({ message: "Git Repository is empty." });

    const commit = await fetch(`${BASE}/git/commits/deadbeef`, {
      headers: authHeaders(),
    });
    expect(commit.status).toBe(409);

    const tree = await fetch(`${BASE}/git/trees/deadbeef`, {
      headers: authHeaders(),
    });
    expect(tree.status).toBe(409);

    const blob = await fetch(`${BASE}/git/blobs/deadbeef`, {
      headers: authHeaders(),
    });
    expect(blob.status).toBe(409);
  });

  it("PUT contents creates only the configured default branch", async () => {
    const mock = useMock({ defaultBranch: "master" });

    const res = await fetch(`${BASE}/contents/notes/a.md`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ message: "init", content: btoa("hello") }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      content: { path: string; sha: string };
      commit: { sha: string; parents: unknown[] };
    };
    expect(body.content.path).toBe("notes/a.md");
    expect(body.commit.parents).toEqual([]);

    expect(mock.git.getRef("master")).toBe(body.commit.sha);
    expect(mock.git.getRef("main")).toBeUndefined();
  });
});

describe("MockGitHubRepo blobs", () => {
  it("round-trips content through POST then GET with wrapped base64", async () => {
    useMock();
    await putFirstFile("notes/seed.md", "seed");

    const text = "a".repeat(80) + "\nécafé";
    const postRes = await fetch(`${BASE}/git/blobs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: text, encoding: "utf-8" }),
    });
    expect(postRes.status).toBe(201);
    const { sha } = (await postRes.json()) as { sha: string };

    const getRes = await fetch(`${BASE}/git/blobs/${sha}`, {
      headers: authHeaders(),
    });
    expect(getRes.status).toBe(200);
    const blob = (await getRes.json()) as { content: string; sha: string };
    expect(blob.content).toContain("\n");
    expect(decodeWrappedBase64(blob.content)).toBe(text);
  });
});

describe("MockGitHubRepo trees, commits and refs", () => {
  it("creates a tree and commit, then fast-forwards the ref", async () => {
    const mock = useMock();
    const { commitSha: firstSha } = await putFirstFile("notes/a.md", "first");
    const firstCommit = mock.git.getCommit(firstSha);
    expect(firstCommit).toBeDefined();

    const treeRes = await fetch(`${BASE}/git/trees`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        base_tree: firstCommit?.tree,
        tree: [
          {
            path: "notes/b.md",
            mode: "100644",
            type: "blob",
            content: "second",
          },
        ],
      }),
    });
    expect(treeRes.status).toBe(201);
    const { sha: newTreeSha } = (await treeRes.json()) as { sha: string };

    const commitRes = await fetch(`${BASE}/git/commits`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: "second commit",
        tree: newTreeSha,
        parents: [firstSha],
      }),
    });
    expect(commitRes.status).toBe(201);
    const { sha: secondSha } = (await commitRes.json()) as { sha: string };

    const patchRes = await fetch(`${BASE}/git/refs/heads/main`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ sha: secondSha, force: false }),
    });
    expect(patchRes.status).toBe(200);
    expect(mock.git.getRef("main")).toBe(secondSha);
  });

  it("creates an empty blob from empty inline tree content", async () => {
    const mock = useMock();
    const { commitSha } = await putFirstFile("notes/a.md", "first");

    const treeRes = await fetch(`${BASE}/git/trees`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        base_tree: mock.git.getCommit(commitSha)?.tree,
        tree: [{ path: "dir/.keep", mode: "100644", type: "blob", content: "" }],
      }),
    });

    expect(treeRes.status).toBe(201);
    const { tree } = (await treeRes.json()) as {
      tree: { path: string; sha: string }[];
    };
    const keep = tree.find((entry) => entry.path === "dir/.keep");
    expect(keep?.sha).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(mock.git.getBlob(keep?.sha ?? "")).toBe("");
  });

  it("rejects a tree entry carrying both sha and content", async () => {
    const mock = useMock();
    const { commitSha, blobSha } = await putFirstFile("notes/a.md", "first");

    const treeRes = await fetch(`${BASE}/git/trees`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        base_tree: mock.git.getCommit(commitSha)?.tree,
        tree: [
          {
            path: "notes/b.md",
            mode: "100644",
            type: "blob",
            sha: blobSha,
            content: "second",
          },
        ],
      }),
    });

    expect(treeRes.status).toBe(422);
  });

  it("returns 422 Update is not a fast forward for a non-ancestor sha", async () => {
    const mock = useMock();
    const { commitSha: firstSha } = await putFirstFile("notes/a.md", "first");
    const firstCommit = mock.git.getCommit(firstSha);
    expect(firstCommit).toBeDefined();

    // Advance main once, then try to fast-forward it to a sibling of the
    // original head, whose ancestry never includes the current head.
    const advanceRes = await fetch(`${BASE}/git/commits`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: "advance",
        tree: firstCommit?.tree,
        parents: [firstSha],
      }),
    });
    const { sha: advancedSha } = (await advanceRes.json()) as { sha: string };
    await fetch(`${BASE}/git/refs/heads/main`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ sha: advancedSha, force: false }),
    });

    const siblingRes = await fetch(`${BASE}/git/commits`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        message: "sibling",
        tree: firstCommit?.tree,
        parents: [firstSha],
      }),
    });
    const { sha: siblingSha } = (await siblingRes.json()) as { sha: string };

    const patchRes = await fetch(`${BASE}/git/refs/heads/main`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ sha: siblingSha, force: false }),
    });
    expect(patchRes.status).toBe(422);
    expect(await patchRes.json()).toEqual({
      message: "Update is not a fast forward",
    });
    expect(mock.git.getRef("main")).toBe(advancedSha);
  });

  it("reports truncated according to truncateTrees", async () => {
    const mock = useMock();
    const { commitSha } = await putFirstFile("notes/a.md", "first");
    const commit = mock.git.getCommit(commitSha);

    const notTruncated = await fetch(`${BASE}/git/trees/${commit?.tree}`, {
      headers: authHeaders(),
    });
    expect((await notTruncated.json()).truncated).toBe(false);

    mock.truncateTrees = true;
    const truncated = await fetch(`${BASE}/git/trees/${commit?.tree}`, {
      headers: authHeaders(),
    });
    expect((await truncated.json()).truncated).toBe(true);
  });
});

describe("MockGitHubRepo read-only token", () => {
  it("returns 403 on every write endpoint", async () => {
    const mock = useMock({ canWrite: false });

    const putContents = await fetch(`${BASE}/contents/notes/a.md`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ message: "init", content: btoa("hello") }),
    });
    expect(putContents.status).toBe(403);

    const postRefs = await fetch(`${BASE}/git/refs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ref: "refs/heads/main", sha: "deadbeef" }),
    });
    expect(postRefs.status).toBe(403);

    const patchRefs = await fetch(`${BASE}/git/refs/heads/main`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ sha: "deadbeef", force: true }),
    });
    expect(patchRefs.status).toBe(403);

    const postCommits = await fetch(`${BASE}/git/commits`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: "x", tree: "deadbeef", parents: [] }),
    });
    expect(postCommits.status).toBe(403);

    const postTrees = await fetch(`${BASE}/git/trees`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ tree: [] }),
    });
    expect(postTrees.status).toBe(403);

    const postBlobs = await fetch(`${BASE}/git/blobs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "hi", encoding: "utf-8" }),
    });
    expect(postBlobs.status).toBe(403);

    for (const res of [
      putContents,
      postRefs,
      patchRefs,
      postCommits,
      postTrees,
      postBlobs,
    ]) {
      expect(await res.json()).toEqual({
        message: "Resource not accessible by personal access token",
      });
    }

    expect(mock.git.hasCommits()).toBe(false);
  });
});

describe("MockGitHubRepo failure injection", () => {
  it("failNext applies once, FIFO, then the next request succeeds", async () => {
    const mock = useMock();
    await putFirstFile("notes/a.md", "first");

    mock.failNext(
      { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
      {
        status: 429,
        body: { message: "You have hit a secondary rate limit" },
        headers: { "retry-after": "30" },
      },
    );

    const limited = await fetch(`${BASE}/git/ref/heads/main`, {
      headers: authHeaders(),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    expect(await limited.json()).toEqual({
      message: "You have hit a secondary rate limit",
    });

    const succeeds = await fetch(`${BASE}/git/ref/heads/main`, {
      headers: authHeaders(),
    });
    expect(succeeds.status).toBe(200);
  });

  it("a network failure makes fetch reject", async () => {
    const mock = useMock();
    mock.failNext({ method: "GET", pathPattern: /.*/ }, { network: true });

    await expect(
      fetch(`${BASE}`, { headers: authHeaders() }),
    ).rejects.toThrow();
  });
});

describe("MockGitHubRepo commit list links", () => {
  async function seedCommits(mock: MockGitHubRepo, count: number) {
    let parent: string | null = null;
    for (let i = 0; i < count; i++) {
      parent = await commitFiles(mock.git, {
        parent,
        files: { "a.md": `v${i}` },
        message: `edit ${i}`,
        branch: "main",
      });
    }
    return parent ?? "";
  }

  it("sends next and last links on the first of several pages", async () => {
    const mock = useMock();
    const head = await seedCommits(mock, 5);

    const res = await fetch(
      `${BASE}/commits?sha=${head}&path=a.md&per_page=1&page=1`,
      { headers: authHeaders() },
    );

    const link = res.headers.get("link") ?? "";
    expect(link).toContain(
      `<${BASE}/commits?sha=${head}&path=a.md&per_page=1&page=2>; rel="next"`,
    );
    expect(link).toContain(
      `<${BASE}/commits?sha=${head}&path=a.md&per_page=1&page=5>; rel="last"`,
    );
    expect(link).not.toContain('rel="prev"');
  });

  it("sends prev and first links on a later page and omits last when withoutLast", async () => {
    const mock = useMock();
    const head = await seedCommits(mock, 5);

    const middle = await fetch(
      `${BASE}/commits?sha=${head}&path=a.md&per_page=1&page=3`,
      { headers: authHeaders() },
    );
    expect(middle.headers.get("link")).toContain('rel="prev"');
    expect(middle.headers.get("link")).toContain('rel="first"');

    mock.commitListLinks = "withoutLast";
    const res = await fetch(
      `${BASE}/commits?sha=${head}&path=a.md&per_page=1&page=1`,
      { headers: authHeaders() },
    );
    expect(res.headers.get("link")).toContain('rel="next"');
    expect(res.headers.get("link")).not.toContain('rel="last"');
  });

  it("sends no link header when the listing fits one page", async () => {
    const mock = useMock();
    const head = await seedCommits(mock, 2);

    const res = await fetch(`${BASE}/commits?sha=${head}&path=a.md`, {
      headers: authHeaders(),
    });

    expect(res.headers.get("link")).toBeNull();
  });
});
