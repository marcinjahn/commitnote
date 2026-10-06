import { http, HttpResponse } from "msw";
import type {
  ContractOperation,
  ContractSeed,
  ContractShareOperation,
  ContractSubject,
  ForgeContractHarness,
  InjectedFailure,
} from "../contract/forge-adapter-contract";
import {
  describeForgeAdapterContract,
  inMemorySubjectHooks,
  toMockFailure,
} from "../contract/forge-adapter-contract";
import { seedCommits } from "../fake/in-memory-git-repo";
import type { ContentCreatingRequest } from "../forge-adapter";
import { createGitHubAdapter } from "./github-adapter";
import { MockGitHubRepo } from "./testing/mock-github-server";
import { useMswServer } from "../fake/msw-test-server";

const OWNER = "acme";
const REPO = "notes";
const TOKEN = "s3cr3t-token";

const getServer = useMswServer();

interface FailureMatch {
  readonly method: string;
  readonly pathPattern: RegExp;
}

// Where an injected failure lands on the wire: most kinds hit the operation's
// first request, but 'stale' is a specific status on a later, specific
// request rather than a transport-level failure.
const FIRST_REQUEST_MATCH: Record<ContractOperation, FailureMatch> = {
  inspect: { method: "GET", pathPattern: /\/repos\/[^/]+\/[^/]+$/ },
  initialize: { method: "PUT", pathPattern: /\/contents\// },
  getHead: { method: "GET", pathPattern: /\/git\/ref\/heads\/main$/ },
  listTree: { method: "GET", pathPattern: /\/git\/commits\// },
  readBlob: { method: "GET", pathPattern: /\/git\/blobs\// },
  commit: { method: "GET", pathPattern: /\/git\/commits\// },
  listCommits: { method: "GET", pathPattern: /\/commits\?/ },
  findOldestCommit: { method: "GET", pathPattern: /\/commits\?/ },
  readFileAt: { method: "GET", pathPattern: /\/contents\// },
};

// 'stale' isn't an injectable MockGitHubRepo status (GitHub's real 422/409
// responses there come from the mock's own business logic, not a canned
// failure), so it's simulated with a one-shot MSW override on the exact
// request the adapter is documented to treat as stale, ahead of the mock's
// own handlers, and consumed without touching the mock's git state.
const STALE_OVERRIDE: Record<
  "initialize" | "commit",
  { method: "put" | "patch"; urlPattern: RegExp; message: string }
> = {
  initialize: {
    method: "put",
    urlPattern: /\/contents\//,
    message: 'Invalid request.\n\n"sha" wasn\'t supplied.',
  },
  commit: {
    method: "patch",
    urlPattern: /\/git\/refs\/heads\/main$/,
    message: "Validation Failed",
  },
};

function forceStale(operation: ContractOperation): void {
  if (operation !== "initialize" && operation !== "commit") {
    throw new Error(`'stale' is not supported for '${operation}'`);
  }
  const override = STALE_OVERRIDE[operation];
  const resolver = (): Response =>
    HttpResponse.json({ message: override.message }, { status: 422 });
  getServer().use(
    override.method === "put"
      ? http.put(override.urlPattern, resolver, { once: true })
      : http.patch(override.urlPattern, resolver, { once: true }),
  );
}

function applyFailure(
  mock: MockGitHubRepo,
  operation: ContractOperation,
  failure: InjectedFailure,
): void {
  if (failure.kind === "stale") {
    forceStale(operation);
    return;
  }

  mock.failNext(FIRST_REQUEST_MATCH[operation], toMockFailure(failure));
}

const SHARE_FAILURE_MATCH: Record<ContractShareOperation, FailureMatch> = {
  createShare: { method: "POST", pathPattern: /\/gists$/ },
  updateShare: { method: "PATCH", pathPattern: /\/gists\// },
  deleteShare: { method: "DELETE", pathPattern: /\/gists\// },
};

const mocks = new WeakMap<ContractSubject, MockGitHubRepo>();

function buildSubject(mock: MockGitHubRepo): ContractSubject {
  getServer().use(...mock.handlers());

  const contentCreatingRequests: ContentCreatingRequest[] = [];
  const adapter = createGitHubAdapter(
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
    failNext: (operation, failure) => applyFailure(mock, operation, failure),
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
    if (locator.provider !== "github") throw new Error("unexpected provider");
    return mocks.get(subject)?.gistContent(locator.gistId) ?? null;
  },

  async createEmpty(options) {
    const mock = new MockGitHubRepo({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      canWrite: options?.canWrite,
      defaultBranch: options?.defaultBranch,
    });
    return buildSubject(mock);
  },

  async createPopulated(seed: ContractSeed, options) {
    const mock = new MockGitHubRepo({
      owner: OWNER,
      repo: REPO,
      token: TOKEN,
      canWrite: options?.canWrite,
    });
    await seedCommits(mock.git, seed.commits, seed.branch);
    return buildSubject(mock);
  },
};

describeForgeAdapterContract("GitHubAdapter", harness);
