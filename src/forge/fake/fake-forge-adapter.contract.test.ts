import { MAIN_BRANCH } from "../../format/v1";
import type {
  ContractOperation,
  ContractSeed,
  ContractSubject,
  ForgeContractHarness,
  InjectedFailure,
} from "../contract/forge-adapter-contract";
import { describeForgeAdapterContract } from "../contract/forge-adapter-contract";
import { ForgeError } from "../errors";
import type { ContentCreatingRequest } from "../forge-adapter";
import { commitFiles, InMemoryGitRepo } from "./in-memory-git-repo";
import { FakeForgeAdapter } from "./fake-forge-adapter";

function translateFailure(failure: InjectedFailure): ForgeError | "stale" {
  if (failure.kind === "stale") {
    return "stale";
  }
  if (failure.kind === "RateLimited") {
    return new ForgeError("RateLimited", {
      retryAfterMs: failure.retryAfterSeconds * 1000,
    });
  }
  return new ForgeError(failure.kind);
}

function buildSubject(
  repo: InMemoryGitRepo,
  options?: { canWrite?: boolean; defaultBranch?: string },
): ContractSubject {
  const contentCreatingRequests: ContentCreatingRequest[] = [];
  const adapter = new FakeForgeAdapter({
    repo,
    canWrite: options?.canWrite,
    defaultBranch: options?.defaultBranch,
    onContentCreatingRequest: (request) =>
      contentCreatingRequests.push(request),
  });

  return {
    adapter,
    contentCreatingRequests,
    pushFromAnotherDevice: (changes) => adapter.pushFromAnotherDevice(changes),
    failNext: (operation: ContractOperation, failure: InjectedFailure) =>
      adapter.failNext(operation, translateFailure(failure)),
    readFileAtMain: async (path) => {
      const head = repo.getRef(MAIN_BRANCH);
      if (head === undefined) {
        return undefined;
      }
      const commit = repo.getCommit(head);
      if (commit === undefined) {
        return undefined;
      }
      const sha = repo.getTree(commit.tree)?.get(path);
      return sha === undefined ? undefined : repo.getBlob(sha);
    },
    mainHead: async () => repo.getRef(MAIN_BRANCH),
    commitParent: async (sha) => repo.getCommit(sha)?.parent,
  };
}

const harness: ForgeContractHarness = {
  async createEmpty(options) {
    return buildSubject(new InMemoryGitRepo(), options);
  },

  async createPopulated(seed: ContractSeed, options) {
    const repo = new InMemoryGitRepo();
    const branch = seed.branch ?? MAIN_BRANCH;
    let parent: string | null = null;
    for (const [index, commitSeed] of seed.commits.entries()) {
      const isLastCommit = index === seed.commits.length - 1;
      parent = await commitFiles(repo, {
        parent,
        files: { ...commitSeed.files },
        message: commitSeed.message,
        branch: isLastCommit ? branch : undefined,
      });
    }
    return buildSubject(repo, options);
  },
};

describeForgeAdapterContract("FakeForgeAdapter", harness);
