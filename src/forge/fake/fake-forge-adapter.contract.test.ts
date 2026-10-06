import type {
  ContractOperation,
  ContractShareOperation,
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
import { createFakeShareStore, type FakeShareStore } from "./fake-share-store";
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

const stores = new WeakMap<ContractSubject, FakeShareStore>();

function buildSubject(
  repo: InMemoryGitRepo,
  options?: { canWrite?: boolean; defaultBranch?: string },
): ContractSubject {
  const contentCreatingRequests: ContentCreatingRequest[] = [];
  const shareStore = createFakeShareStore();
  const adapter = new FakeForgeAdapter({
    shares: { store: shareStore, provider: "github" },
    repo,
    canWrite: options?.canWrite,
    defaultBranch: options?.defaultBranch,
    onContentCreatingRequest: (request) =>
      contentCreatingRequests.push(request),
  });

  const subject: ContractSubject = {
    adapter,
    contentCreatingRequests,
    ...inMemorySubjectHooks(repo),
    pushFromAnotherDevice: (changes) => adapter.pushFromAnotherDevice(changes),
    failNext: (operation: ContractOperation, failure: InjectedFailure) =>
      adapter.failNext(operation, translateFailure(failure)),
    failNextShare: (
      operation: ContractShareOperation,
      failure: InjectedFailure,
    ) => adapter.failNext(operation, translateFailure(failure)),
  };
  stores.set(subject, shareStore);
  return subject;
}

const harness: ForgeContractHarness = {
  async readShare(subject, locator) {
    return stores.get(subject)?.read(locator) ?? null;
  },

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
