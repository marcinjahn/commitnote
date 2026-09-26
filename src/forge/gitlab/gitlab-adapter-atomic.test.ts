import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http } from "msw";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import { commitFiles } from "../fake/in-memory-git-repo";
import type { CommitRequest, ContentCreatingRequest } from "../forge-adapter";
import {
  ABANDONED_AFTER_MS,
  ATOMIC_BRANCH_PREFIX,
  createGitLabAdapter,
  MAX_MERGE_ATTEMPTS,
  MERGE_STATUS_POLL_MS,
} from "./gitlab-adapter";
import type { GitLabAdapterOptions } from "./gitlab-adapter";
import type { MockGitLabRepoOptions } from "./testing/mock-gitlab-server";
import { MockGitLabRepo } from "./testing/mock-gitlab-server";

const PROJECT = "acme/notes";
const TOKEN = "s3cr3t-token";
const NOW = Date.parse("2026-10-01T12:00:00Z");

const COMMITS = { method: "POST", pathPattern: /\/repository\/commits$/ };
const CREATE_MR = { method: "POST", pathPattern: /\/merge_requests$/ };
const MERGE = { method: "PUT", pathPattern: /\/merge_requests\/\d+\/merge$/ };
const GET_MR = { method: "GET", pathPattern: /\/merge_requests\/\d+$/ };
const MERGE_BASE = { method: "GET", pathPattern: /\/repository\/merge_base\?/ };

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

function makeAdapter(options?: Partial<GitLabAdapterOptions>) {
  const reports: ContentCreatingRequest[] = [];
  const sleeps: number[] = [];
  const adapter = createGitLabAdapter(
    { owner: "acme", repo: "notes" },
    {
      accessToken: TOKEN,
      now: () => NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      randomId: () => "0000-1111",
      onContentCreatingRequest: (request) => reports.push(request),
      ...options,
    },
  );
  return { adapter, reports, sleeps };
}

function seed(mock: MockGitLabRepo): Promise<string> {
  return commitFiles(mock.git, {
    parent: null,
    files: { [REPO_CONFIG_PATH]: "{}" },
    message: "init",
    branch: MAIN_BRANCH,
  });
}

async function pushToMain(mock: MockGitLabRepo, text: string): Promise<string> {
  const parent = mock.git.getRef(MAIN_BRANCH) ?? null;
  const tree =
    parent === null ? null : (mock.git.getCommit(parent)?.tree ?? null);
  const sha = await mock.git.putCommit({
    tree: await mock.git.applyChanges(tree, [
      { kind: "upsert-text", path: "theirs.md", text },
    ]),
    parent,
    message: "elsewhere",
  });
  mock.git.setRef(MAIN_BRANCH, sha);
  return sha;
}

function atomicRequest(parent: string): CommitRequest {
  return {
    parent,
    changes: [{ kind: "upsert-text", path: "bulk/a.md", text: "a" }],
    message: "commitnote: import",
    atomic: true,
  };
}

function transactionBranches(mock: MockGitLabRepo): string[] {
  return mock.git
    .branchNames()
    .filter((name) => name.startsWith(ATOMIC_BRANCH_PREFIX));
}

function countRequests(
  mock: MockGitLabRepo,
  match: { method: string; pathPattern: RegExp },
): number {
  return mock.requests.filter(
    (request) =>
      request.method === match.method && match.pathPattern.test(request.path),
  ).length;
}

function captureBodies(
  method: "post" | "put",
  pattern: RegExp,
): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http[method](pattern, async ({ request }) => {
      bodies.push(await request.clone().json());
      return undefined;
    }),
  );
  return bodies;
}

describe("GitLabAdapter atomic commits", () => {
  describe("setup detection", () => {
    it("reports needsSetup without configure rights for a Developer on a merge-commit project", async () => {
      const mock = useMock({ mergeMethod: "merge" });
      await seed(mock);

      expect(await makeAdapter().adapter.atomicCommitSupport?.()).toEqual({
        kind: "needsSetup",
        canConfigure: false,
      });
    });

    it("lets a Maintainer switch the project to fast-forward merges and relaxes blocking settings", async () => {
      const mock = useMock({ mergeMethod: "merge", maintainer: true });
      await seed(mock);
      mock.squashOption = "always";
      mock.onlyAllowMergeIfPipelineSucceeds = true;
      const bodies = captureBodies("put", /\/projects\/[^/]+$/);
      const { adapter, reports } = makeAdapter();

      expect(await adapter.atomicCommitSupport?.()).toEqual({
        kind: "needsSetup",
        canConfigure: true,
      });
      expect(await adapter.enableAtomicCommits?.()).toEqual({
        kind: "available",
      });
      expect(await adapter.atomicCommitSupport?.()).toEqual({
        kind: "available",
      });

      expect(bodies).toEqual([
        {
          merge_method: "ff",
          squash_option: "default_off",
          only_allow_merge_if_pipeline_succeeds: false,
        },
      ]);
      expect(mock.mergeMethod).toBe("ff");
      expect(reports.map((report) => report.operation)).toEqual([
        "updateProject",
      ]);
    });

    it("cannot be configured when merge approvals are required", async () => {
      const mock = useMock({ maintainer: true });
      await seed(mock);
      mock.approvalsBeforeMerge = 1;

      expect(await makeAdapter().adapter.atomicCommitSupport?.()).toEqual({
        kind: "needsSetup",
        canConfigure: false,
      });
    });

    it("checks the project settings once per adapter", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      const { adapter } = makeAdapter();

      await adapter.commit(atomicRequest(parent));
      await adapter.commit(atomicRequest(mock.git.getRef(MAIN_BRANCH) ?? ""));

      expect(
        mock.requests.filter(
          (request) =>
            request.method === "GET" && /\/projects\/[^/]+$/.test(request.path),
        ),
      ).toHaveLength(1);
    });

    it("rejects an atomic commit with Forbidden before writing anything while setup is needed", async () => {
      const mock = useMock({ mergeMethod: "rebase_merge" });
      const parent = await seed(mock);
      const { adapter, reports } = makeAdapter();

      await expect(adapter.commit(atomicRequest(parent))).rejects.toMatchObject(
        { kind: "Forbidden" },
      );
      expect(reports).toEqual([]);
      expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
    });
  });

  it("commits on a fresh branch from the parent and fast-forwards main through a merge request", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    const commitBodies = captureBodies("post", /\/repository\/commits$/);
    const mergeRequestBodies = captureBodies("post", /\/merge_requests$/);
    const mergeBodies = captureBodies("put", /\/merge_requests\/\d+\/merge$/);
    const { adapter, reports } = makeAdapter();

    const result = await adapter.commit(atomicRequest(parent));

    const head = mock.git.getRef(MAIN_BRANCH) ?? "";
    expect(result).toEqual({ kind: "ok", head });
    expect(mock.git.getCommit(head)?.parent).toBe(parent);
    expect(mock.git.getCommit(head)?.message).toBe("commitnote: import");
    expect(commitBodies).toMatchObject([
      {
        branch: `${ATOMIC_BRANCH_PREFIX}0000-1111`,
        start_sha: parent,
        commit_message: "commitnote: import",
      },
    ]);
    expect(mergeRequestBodies).toEqual([
      {
        source_branch: `${ATOMIC_BRANCH_PREFIX}0000-1111`,
        target_branch: MAIN_BRANCH,
        title: "commitnote: atomic commit",
        remove_source_branch: true,
        squash: false,
      },
    ]);
    expect(mergeBodies).toEqual([
      { sha: head, squash: false, should_remove_source_branch: true },
    ]);
    expect(transactionBranches(mock)).toEqual([]);
    expect(reports.map((report) => report.operation)).toEqual([
      "createCommit",
      "createMergeRequest",
      "mergeMergeRequest",
    ]);
    expect(reports).toHaveLength(
      adapter.commitCost(atomicRequest(parent).changes, { atomic: true }),
    );
  });

  it("returns stale and cleans up when main moves before the merge", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    let theirs = "";
    server.use(
      http.post(
        /\/merge_requests$/,
        async () => {
          theirs = await pushToMain(mock, "theirs");
          return undefined;
        },
        { once: true },
      ),
    );

    const result = await makeAdapter().adapter.commit(atomicRequest(parent));

    expect(result).toEqual({ kind: "stale" });
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(theirs);
    expect(transactionBranches(mock)).toEqual([]);
    expect([...mock.mergeRequests.values()].map((mr) => mr.state)).toEqual([
      "closed",
    ]);
  });

  it("polls the merge status while GitLab is still checking mergeability", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.mergeCheckingRounds = 2;
    const { adapter, sleeps } = makeAdapter();

    const result = await adapter.commit(atomicRequest(parent));

    expect(result).toEqual({
      kind: "ok",
      head: mock.git.getRef(MAIN_BRANCH),
    });
    expect(sleeps).toEqual([MERGE_STATUS_POLL_MS, MERGE_STATUS_POLL_MS]);
  });

  it("gives up with Server and cleans up when mergeability never settles", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.mergeCheckingRounds = 100;
    const { adapter, sleeps } = makeAdapter();

    await expect(adapter.commit(atomicRequest(parent))).rejects.toMatchObject({
      kind: "Server",
    });
    expect(sleeps).toHaveLength(MAX_MERGE_ATTEMPTS - 1);
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
    expect(transactionBranches(mock)).toEqual([]);
  });

  it("rejects with Server and cleans up when a project rule blocks the merge", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    const { adapter } = makeAdapter();
    expect(await adapter.atomicCommitSupport?.()).toEqual({
      kind: "available",
    });
    mock.approvalsBeforeMerge = 1;

    await expect(adapter.commit(atomicRequest(parent))).rejects.toMatchObject({
      kind: "Server",
    });
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
    expect(transactionBranches(mock)).toEqual([]);
    expect(await adapter.atomicCommitSupport?.()).toMatchObject({
      kind: "needsSetup",
    });
  });

  it("maps a 401 from the merge endpoint to Forbidden", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    mock.failNext(MERGE, { status: 401 });

    await expect(
      makeAdapter().adapter.commit(atomicRequest(parent)),
    ).rejects.toMatchObject({ kind: "Forbidden" });
    expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
  });

  describe("ambiguous network failures", () => {
    it("reuses the branch when the commit request got through", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.dropNextResponse(COMMITS);

      const result = await makeAdapter().adapter.commit(atomicRequest(parent));

      const head = mock.git.getRef(MAIN_BRANCH) ?? "";
      expect(result).toEqual({ kind: "ok", head });
      expect(mock.git.getCommit(head)?.parent).toBe(parent);
      expect(countRequests(mock, COMMITS)).toBe(1);
    });

    it("rejects with Network and leaves main alone when the commit request did not get through", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.failNext(COMMITS, { network: true });

      await expect(
        makeAdapter().adapter.commit(atomicRequest(parent)),
      ).rejects.toMatchObject({ kind: "Network" });
      expect(mock.git.getRef(MAIN_BRANCH)).toBe(parent);
      expect(transactionBranches(mock)).toEqual([]);
    });

    it("reuses the merge request when its creation got through", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.dropNextResponse(CREATE_MR);

      const result = await makeAdapter().adapter.commit(atomicRequest(parent));

      expect(result).toEqual({
        kind: "ok",
        head: mock.git.getRef(MAIN_BRANCH),
      });
      expect(mock.mergeRequests.size).toBe(1);
    });

    it("reports ok when the merge got through but its response was lost", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.dropNextResponse(MERGE);

      const result = await makeAdapter().adapter.commit(atomicRequest(parent));

      const head = mock.git.getRef(MAIN_BRANCH) ?? "";
      expect(result).toEqual({ kind: "ok", head });
      expect(mock.git.getCommit(head)?.parent).toBe(parent);
      expect(countRequests(mock, MERGE)).toBe(1);
    });

    it("retries the merge when the merge request did not get through", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.failNext(MERGE, { network: true });

      const result = await makeAdapter().adapter.commit(atomicRequest(parent));

      const head = mock.git.getRef(MAIN_BRANCH) ?? "";
      expect(result).toEqual({ kind: "ok", head });
      expect(mock.git.getCommit(head)?.parent).toBe(parent);
    });

    it("reads main to settle a merge whose response and status were lost", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.dropNextResponse(MERGE);
      mock.failNext(GET_MR, { network: true });

      const result = await makeAdapter().adapter.commit(atomicRequest(parent));

      expect(result).toEqual({ kind: "ok", head: mock.git.getRef(MAIN_BRANCH) });
    });

    it("rejects with Network when the merge outcome cannot be read back at all", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      mock.dropNextResponse(MERGE);
      mock.failNext(GET_MR, { network: true });
      mock.failNext(MERGE_BASE, { network: true });

      await expect(
        makeAdapter().adapter.commit(atomicRequest(parent)),
      ).rejects.toMatchObject({ kind: "Network", mainUnchanged: false });
    });
  });

  describe("sweepAbandoned", () => {
    it("closes and deletes only transaction leftovers older than the cutoff", async () => {
      const mock = useMock();
      const parent = await seed(mock);
      const oldTime = NOW - ABANDONED_AFTER_MS - 1;
      mock.git.setRef(`${ATOMIC_BRANCH_PREFIX}old`, parent);
      mock.setCommitDate(parent, new Date(oldTime));
      const fresh = await pushToMain(mock, "fresh");
      mock.git.setRef(MAIN_BRANCH, parent);
      mock.git.setRef(`${ATOMIC_BRANCH_PREFIX}fresh`, fresh);
      mock.setCommitDate(fresh, new Date(NOW));
      mock.git.setRef("feature", fresh);
      mock.mergeRequests.set(1, {
        iid: 1,
        sourceBranch: `${ATOMIC_BRANCH_PREFIX}old`,
        targetBranch: MAIN_BRANCH,
        title: "x",
        createdAt: new Date(oldTime).toISOString(),
        removeSourceBranch: true,
        state: "opened",
      });
      mock.mergeRequests.set(2, {
        iid: 2,
        sourceBranch: `${ATOMIC_BRANCH_PREFIX}fresh`,
        targetBranch: MAIN_BRANCH,
        title: "x",
        createdAt: new Date(NOW).toISOString(),
        removeSourceBranch: true,
        state: "opened",
      });
      mock.mergeRequests.set(3, {
        iid: 3,
        sourceBranch: "feature",
        targetBranch: MAIN_BRANCH,
        title: "x",
        createdAt: new Date(oldTime).toISOString(),
        removeSourceBranch: false,
        state: "opened",
      });
      const { adapter, reports } = makeAdapter();

      await adapter.sweepAbandoned?.();

      expect(mock.mergeRequests.get(1)?.state).toBe("closed");
      expect(mock.mergeRequests.get(2)?.state).toBe("opened");
      expect(mock.mergeRequests.get(3)?.state).toBe("opened");
      expect(mock.git.branchNames().sort()).toEqual(
        [MAIN_BRANCH, `${ATOMIC_BRANCH_PREFIX}fresh`, "feature"].sort(),
      );
      expect(reports.map((report) => report.operation)).toEqual([
        "closeMergeRequest",
        "deleteRef",
      ]);
    });

    it("makes no writes when nothing is left over", async () => {
      const mock = useMock();
      await seed(mock);
      const { adapter, reports } = makeAdapter();

      await adapter.sweepAbandoned?.();

      expect(reports).toEqual([]);
    });
  });

  it("keeps the non-atomic commit cost and path unchanged", async () => {
    const mock = useMock();
    const parent = await seed(mock);
    const { adapter } = makeAdapter();

    expect(adapter.commitCost([], { atomic: false })).toBe(1);
    await adapter.commit({ ...atomicRequest(parent), atomic: false });

    expect(mock.mergeRequests.size).toBe(0);
    expect(mock.requests.some((r) => r.path.includes("merge_requests"))).toBe(
      false,
    );
  });
});

