import { http, HttpResponse } from "msw";
import { MAIN_BRANCH } from "../../format/v1";
import type {
  ContractOperation,
  ContractSeed,
  ContractShareOperation,
  ContractSubject,
  ForgeContractHarness,
} from "../contract/forge-adapter-contract";
import {
  describeForgeAdapterContract,
  inMemorySubjectHooks,
  toMockFailure,
} from "../contract/forge-adapter-contract";
import { seedCommits } from "../fake/in-memory-git-repo";
import type { ContentCreatingRequest } from "../forge-adapter";
import { createGitLabAdapter } from "./gitlab-adapter";
import { MockGitLabRepo } from "./testing/mock-gitlab-server";
import { useMswServer } from "../fake/msw-test-server";

const OWNER = "acme/personal";
const REPO = "notes";
const TOKEN = "s3cr3t-token";

const getServer = useMswServer();

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
  listCommits: { method: "GET", pathPattern: /\/repository\/commits\?/ },
  findOldestCommit: { method: "GET", pathPattern: /\/repository\/commits\?/ },
  readFileAt: { method: "GET", pathPattern: /\/repository\/files\/[^/]+\?/ },
};

// GitLab has no stale response code: the adapter detects staleness by
// reading main (commit) or the project's emptiness (initialize) before
// writing, so 'stale' is simulated by a one-shot override of that read.
function forceStale(operation: ContractOperation): void {
  if (operation === "commit") {
    getServer().use(
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
    getServer().use(
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

const SHARE_FAILURE_MATCH: Record<
  ContractShareOperation,
  { method: string; pathPattern: RegExp }
> = {
  createShare: { method: "POST", pathPattern: /\/snippets$/ },
  deleteShare: { method: "DELETE", pathPattern: /\/snippets\// },
};

const mocks = new WeakMap<ContractSubject, MockGitLabRepo>();

function buildSubject(mock: MockGitLabRepo): ContractSubject {
  getServer().use(...mock.handlers());

  const contentCreatingRequests: ContentCreatingRequest[] = [];
  const adapter = createGitLabAdapter(
    { owner: OWNER, repo: REPO },
    {
      accessToken: TOKEN,
      onContentCreatingRequest: (request) =>
        contentCreatingRequests.push(request),
    },
  );

  const subject: ContractSubject = {
    adapter,
    contentCreatingRequests,
    ...inMemorySubjectHooks(mock.git),
    failNext(operation, failure) {
      if (failure.kind === "stale") {
        forceStale(operation);
        return;
      }
      mock.failNext(FAILURE_MATCH[operation], toMockFailure(failure));
    },
    failNextShare(operation, failure) {
      if (failure.kind === "stale") {
        throw new Error("'stale' is not supported for shares");
      }
      mock.failNext(SHARE_FAILURE_MATCH[operation], toMockFailure(failure));
    },
  };
  mocks.set(subject, mock);
  return subject;
}

const harness: ForgeContractHarness = {
  async readShare(subject, locator) {
    if (locator.provider !== "gitlab") throw new Error("unexpected provider");
    return mocks.get(subject)?.snippetContent(locator.snippetId) ?? null;
  },

  async createEmpty(options) {
    return buildSubject(
      new MockGitLabRepo({
        projectPath: `${OWNER}/${REPO}`,
        token: TOKEN,
        mergeMethod: "ff",
        canWrite: options?.canWrite,
        defaultBranch: options?.defaultBranch,
      }),
    );
  },

  async createPopulated(seed: ContractSeed, options) {
    const mock = new MockGitLabRepo({
      projectPath: `${OWNER}/${REPO}`,
      token: TOKEN,
      mergeMethod: "ff",
      canWrite: options?.canWrite,
    });
    await seedCommits(mock.git, seed.commits, seed.branch);
    return buildSubject(mock);
  },
};

describeForgeAdapterContract("GitLabAdapter", harness);
