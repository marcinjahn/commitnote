import type {
  ContractOperation,
  ContractSeed,
  ContractSubject,
  ForgeContractHarness,
  InjectedFailure,
} from "../contract/forge-adapter-contract";
import {
  describeForgeAdapterContract,
  inMemorySubjectHooks,
} from "../contract/forge-adapter-contract";
import { ForgeError } from "../errors";
import type { ContentCreatingRequest } from "../forge-adapter";
import { InMemoryGitRepo, seedCommits } from "./in-memory-git-repo";
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
    ...inMemorySubjectHooks(repo),
    pushFromAnotherDevice: (changes) => adapter.pushFromAnotherDevice(changes),
    failNext: (operation: ContractOperation, failure: InjectedFailure) =>
      adapter.failNext(operation, translateFailure(failure)),
  };
}

const harness: ForgeContractHarness = {
  async createEmpty(options) {
    return buildSubject(new InMemoryGitRepo(), options);
  },

  async createPopulated(seed: ContractSeed, options) {
    const repo = new InMemoryGitRepo();
    await seedCommits(repo, seed.commits, seed.branch);
    return buildSubject(repo, options);
  },
};

describeForgeAdapterContract("FakeForgeAdapter", harness);
