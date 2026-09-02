import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { MAIN_BRANCH, SAVE_SUBJECT } from "../../format/v1";
import type {
  ContractOperation,
  ContractSeed,
  ContractSubject,
  ForgeContractHarness,
  InjectedFailure,
} from "../contract/forge-adapter-contract";
import { describeForgeAdapterContract } from "../contract/forge-adapter-contract";
import { commitFiles } from "../fake/in-memory-git-repo";
import type { ContentCreatingRequest } from "../forge-adapter";
import { createGitLabAdapter } from "./gitlab-adapter";
import type { MockFailure } from "./testing/mock-gitlab-server";
import { MockGitLabRepo } from "./testing/mock-gitlab-server";

const OWNER = "acme/personal";
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

const FAILURE_MATCH: Record<
  ContractOperation,
  { method: string; pathPattern: RegExp }
> = {
  inspect: { method: "GET", pathPattern: /\/projects\/[^/]+$/ },
  initialize: { method: "POST", pathPattern: /\/repository\/commits$/ },
  getHead: { method: "GET", pathPattern: /\/repository\/branches\/main$/ },
  listTree: { method: "GET", pathPattern: /\/repository\/tree\?/ },
  readBlob: { method: "GET", pathPattern: /\/repository\/blobs\// },
  commit: { method: "POST", pathPattern: /\/repository\/commits$/ },
};

// GitLab has no stale response code: the adapter detects staleness by
// reading main (commit) or the project's emptiness (initialize) before
// writing, so 'stale' is simulated by a one-shot override of that read.
function forceStale(operation: ContractOperation): void {
  if (operation === "commit") {
    server.use(
      http.get(
        /\/repository\/branches\/main$/,
        () =>
          HttpResponse.json({
            name: MAIN_BRANCH,
            commit: { id: "0".repeat(40) },
            can_push: true,
          }),
        { once: true },
      ),
    );
    return;
  }
  if (operation === "initialize") {
    server.use(
      http.get(
        /\/projects\/[^/]+$/,
        () => HttpResponse.json({ empty_repo: false }),
        { once: true },
      ),
    );
    return;
  }
  throw new Error(`'stale' is not supported for '${operation}'`);
}

function toMockFailure(
  failure: Exclude<InjectedFailure, { kind: "stale" }>,
): MockFailure {
  switch (failure.kind) {
    case "Unauthorized":
      return { status: 401 };
    case "Forbidden":
      return { status: 403 };
    case "NotFound":
      return { status: 404 };
    case "Server":
      return { status: 500 };
    case "Network":
      return { network: true };
    case "RateLimited":
      return {
        status: 429,
        headers: { "retry-after": String(failure.retryAfterSeconds) },
      };
  }
}

function buildSubject(mock: MockGitLabRepo): ContractSubject {
  server.use(...mock.handlers());

  const contentCreatingRequests: ContentCreatingRequest[] = [];
  const adapter = createGitLabAdapter(
    { owner: OWNER, repo: REPO },
    {
      accessToken: TOKEN,
      onContentCreatingRequest: (request) =>
        contentCreatingRequests.push(request),
    },
  );

  return {
    adapter,
    contentCreatingRequests,
    async pushFromAnotherDevice(changes) {
      const parent = mock.git.getRef(MAIN_BRANCH) ?? null;
      const parentCommit =
        parent === null ? undefined : mock.git.getCommit(parent);
      const treeSha = await mock.git.applyChanges(
        parentCommit?.tree ?? null,
        changes,
      );
      const commitSha = await mock.git.putCommit({
        tree: treeSha,
        parent,
        message: SAVE_SUBJECT,
      });
      mock.git.setRef(MAIN_BRANCH, commitSha);
      return commitSha;
    },
    failNext(operation, failure) {
      if (failure.kind === "stale") {
        forceStale(operation);
        return;
      }
      mock.failNext(FAILURE_MATCH[operation], toMockFailure(failure));
    },
    async readFileAtMain(path) {
      const head = mock.git.getRef(MAIN_BRANCH);
      const commit = head === undefined ? undefined : mock.git.getCommit(head);
      const sha =
        commit === undefined ? undefined : mock.git.getTree(commit.tree)?.get(path);
      return sha === undefined ? undefined : mock.git.getBlob(sha);
    },
    async mainHead() {
      return mock.git.getRef(MAIN_BRANCH);
    },
  };
}

const harness: ForgeContractHarness = {
  async createEmpty(options) {
    return buildSubject(
      new MockGitLabRepo({
        projectPath: `${OWNER}/${REPO}`,
        token: TOKEN,
        canWrite: options?.canWrite,
        defaultBranch: options?.defaultBranch,
      }),
    );
  },

  async createPopulated(seed: ContractSeed, options) {
    const mock = new MockGitLabRepo({
      projectPath: `${OWNER}/${REPO}`,
      token: TOKEN,
      canWrite: options?.canWrite,
    });
    const branch = seed.branch ?? MAIN_BRANCH;
    let parent: string | null = null;
    for (const [index, commitSeed] of seed.commits.entries()) {
      const isLastCommit = index === seed.commits.length - 1;
      parent = await commitFiles(mock.git, {
        parent,
        files: { ...commitSeed.files },
        message: commitSeed.message,
        branch: isLastCommit ? branch : undefined,
      });
    }
    return buildSubject(mock);
  },
};

describeForgeAdapterContract("GitLabAdapter", harness);
