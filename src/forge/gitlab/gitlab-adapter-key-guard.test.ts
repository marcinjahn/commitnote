import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http } from "msw";
import { setupServer, type SetupServer } from "msw/node";
import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import { commitFiles } from "../fake/in-memory-git-repo";
import type { CommitRequest, KeyBoundFile } from "../forge-adapter";
import {
  ATOMIC_BRANCH_PREFIX,
  createGitLabAdapter,
  UNDO_COMMIT_MESSAGE,
} from "./gitlab-adapter";
import {
  MockGitLabRepo,
  type MockGitLabRepoOptions,
} from "./testing/mock-gitlab-server";

const PROJECT = "acme/notes";
const TOKEN = "s3cr3t-token";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const KEEP = "folderA/.keep";
const NOTE = "folderA/noteB";
const CREATE_MR = { method: "POST", pathPattern: /\/merge_requests$/ };
const MERGE = { method: "PUT", pathPattern: /\/merge_requests\/\d+\/merge$/ };

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

function useMock(options?: Partial<MockGitLabRepoOptions>): MockGitLabRepo {
  const mock = new MockGitLabRepo({
    projectPath: PROJECT,
    token: TOKEN,
    mergeMethod: "ff",
    now: () => NOW,
    ...options,
  });
  server.use(...mock.handlers());
  return mock;
}

function makeAdapter() {
  return createGitLabAdapter(
    { owner: "acme", repo: "notes" },
    {
      accessToken: TOKEN,
      now: () => NOW,
      sleep: async () => {},
      randomId: () => "0000-1111",
    },
  );
}

function seed(mock: MockGitLabRepo): Promise<string> {
  return commitFiles(mock.git, {
    parent: null,
    files: {
      [REPO_CONFIG_PATH]: "config v1",
      [KEEP]: "",
      [NOTE]: "v1:note",
      "README.md": "readme",
    },
    message: "init",
    branch: MAIN_BRANCH,
  });
}

async function keyBound(
  mock: MockGitLabRepo,
  head: string,
  paths: readonly string[],
): Promise<KeyBoundFile[]> {
  const files = mock.git.getTree(mock.git.getCommit(head)!.tree)!;
  return paths.map((path) => ({ path, blobSha: files.get(path)! }));
}

function captureCommitBodies(): {
  actions: { action: string; file_path: string; content?: string }[];
}[] {
  const bodies: { actions: { action: string; file_path: string }[] }[] = [];
  server.use(
    http.post(/\/repository\/commits$/, async ({ request }) => {
      bodies.push(
        (await request.clone().json()) as {
          actions: { action: string; file_path: string }[];
        },
      );
      return undefined;
    }),
  );
  return bodies;
}

function createRequest(parent: string, files: KeyBoundFile[]): CommitRequest {
  return {
    parent,
    changes: [{ kind: "upsert-text", path: "folderA/noteC", text: "v1:new" }],
    message: "commitnote: save",
    keyBoundFiles: files,
  };
}

function filesAt(mock: MockGitLabRepo, ref = MAIN_BRANCH) {
  const head = mock.git.getRef(ref)!;
  return new Map(mock.git.getTree(mock.git.getCommit(head)!.tree)!);
}

// Renames every key-bound file and changes the config, as a passphrase
// change on another device does.
async function rekeyOnMain(mock: MockGitLabRepo): Promise<string> {
  const parent = mock.git.getRef(MAIN_BRANCH)!;
  const sha = await mock.git.putCommit({
    tree: await mock.git.applyChanges(mock.git.getCommit(parent)!.tree, [
      { kind: "delete", path: KEEP },
      { kind: "delete", path: NOTE },
      { kind: "upsert-text", path: "folderX/.keep", text: "" },
      { kind: "upsert-text", path: "folderX/noteY", text: "v1:rekeyed" },
      { kind: "upsert-text", path: REPO_CONFIG_PATH, text: "config v2" },
    ]),
    parent,
    message: "commitnote: change passphrase",
  });
  mock.git.setRef(MAIN_BRANCH, sha);
  return sha;
}

describe("GitLabAdapter key guard", () => {
  it("adds an unchanged update of a folder marker to a create-only commit", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    const bodies = captureCommitBodies();

    const result = await makeAdapter().commit(
      createRequest(parent, await keyBound(mock, parent, [NOTE, KEEP])),
    );

    expect(result.kind).toBe("ok");
    expect(bodies[0].actions).toContainEqual({
      action: "update",
      file_path: KEEP,
      content: "",
      encoding: "text",
    });
    const files = filesAt(mock);
    expect(mock.git.getBlob(files.get(KEEP)!)).toBe("");
    expect(mock.git.getBlob(files.get(NOTE)!)).toBe("v1:note");
    expect(mock.git.getBlob(files.get("folderA/noteC")!)).toBe("v1:new");
  });

  it("guards with a note's unchanged content when there is no folder marker", async () => {
    const mock = useMock();
    const parent = await seed(mock);

    const result = await makeAdapter().commit(
      createRequest(parent, await keyBound(mock, parent, [NOTE])),
    );

    expect(result.kind).toBe("ok");
    expect(mock.git.getBlob(filesAt(mock).get(NOTE)!)).toBe("v1:note");
  });

  it("adds no guard when the commit already updates a key-bound file", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    const bodies = captureCommitBodies();

    await makeAdapter().commit({
      parent,
      changes: [{ kind: "upsert-text", path: NOTE, text: "v1:edited" }],
      message: "commitnote: save",
      keyBoundFiles: await keyBound(mock, parent, [NOTE, KEEP]),
    });

    expect(bodies[0].actions).toHaveLength(1);
  });

  it("reports stale instead of landing when main was re-keyed after the head check", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    let rekeyed = "";
    mock.beforeCommitToMain = async () => {
      rekeyed = await rekeyOnMain(mock);
    };

    const result = await makeAdapter().commit(
      createRequest(parent, await keyBound(mock, parent, [KEEP])),
    );

    expect(result).toEqual({ kind: "stale" });
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(rekeyed);
  });

  it("commits atomically when there is no key-bound file to guard with", async () => {
    const mock = useMock();
    const parent = await seed(mock);

    const result = await makeAdapter().commit(createRequest(parent, []));

    expect(result.kind).toBe("ok");
    expect(
      mock.requests.filter(
        (request) =>
          request.method === CREATE_MR.method &&
          CREATE_MR.pathPattern.test(request.path),
      ),
    ).toHaveLength(1);
  });

  it("undoes an unguarded commit that landed on a re-keyed main", async () => {
    const mock = useMock({ mergeMethod: "merge" });
    const parent = await seed(mock);
    let rekeyed = "";
    mock.beforeCommitToMain = async () => {
      rekeyed = await rekeyOnMain(mock);
    };
    const rekeyedFiles = async () =>
      new Map(mock.git.getTree(mock.git.getCommit(rekeyed)!.tree)!);

    const result = await makeAdapter().commit(createRequest(parent, []));

    expect(result).toEqual({ kind: "stale" });
    const head = mock.git.getRef(MAIN_BRANCH)!;
    const undo = mock.git.getCommit(head)!;
    expect(undo.message).toBe(UNDO_COMMIT_MESSAGE);
    expect(mock.git.getCommit(undo.parent!)!.parent).toBe(rekeyed);
    expect(filesAt(mock)).toEqual(await rekeyedFiles());
  });
});

describe("GitLabAdapter atomic merge outcome", () => {
  function atomicRequest(parent: string): CommitRequest {
    return {
      parent,
      changes: [{ kind: "upsert-text", path: "bulk/a", text: "a" }],
      message: "commitnote: import",
      atomic: true,
    };
  }

  it("waits for a merge GitLab is still carrying out", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.mergeLockedReads = 2;

    const result = await makeAdapter().commit(atomicRequest(parent));

    expect(result).toEqual({ kind: "ok", head: mock.git.getRef(MAIN_BRANCH) });
    expect(mock.git.getCommit(mock.git.getRef(MAIN_BRANCH)!)!.parent).toBe(
      parent,
    );
  });

  it("rejects with Network, not stale, while the merge stays locked", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.mergeLockedReads = 1_000;

    await expect(
      makeAdapter().commit(atomicRequest(parent)),
    ).rejects.toMatchObject({
      kind: "Network",
      mainUnchanged: false,
    });
    expect([...mock.mergeRequests.values()][0].state).toBe("locked");
  });

  it("retries a merge answered with a server error", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.failNext(MERGE, { status: 500 });

    const result = await makeAdapter().commit(atomicRequest(parent));

    expect(result.kind).toBe("ok");
  });

  it("leaves nothing open and main untouched when it fails before merging", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.failNext(CREATE_MR, { network: true });
    mock.failNext(
      { method: "GET", pathPattern: /\/merge_requests\?/ },
      {
        network: true,
      },
    );

    await expect(
      makeAdapter().commit(atomicRequest(parent)),
    ).rejects.toMatchObject({
      kind: "Network",
      mainUnchanged: true,
    });
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
    expect(
      mock.git
        .branchNames()
        .filter((name) => name.startsWith(ATOMIC_BRANCH_PREFIX)),
    ).toEqual([]);
  });
});
