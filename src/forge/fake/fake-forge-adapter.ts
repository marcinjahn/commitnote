import { MAIN_BRANCH, REPO_CONFIG_PATH, SAVE_SUBJECT } from "../../format/v1";
import { ForgeError } from "../errors";
import type {
  CommitFileChange,
  CommitRequest,
  CommitResult,
  CommitSummary,
  ContentCreatingRequest,
  FileAtCommit,
  FindOldestCommitRequest,
  ForgeAdapter,
  ForgeWriteLimits,
  ListCommitsRequest,
  ReplaceHistoryRequest,
  RepoInspection,
  RootEntry,
  TreeEntry,
} from "../forge-adapter";
import type { ShareHost, ShareLocator } from "../share-host";
import { createFakeShareStore, type FakeShareStore } from "./fake-share-store";
import {
  GITHUB_WRITE_LIMITS,
  gitHubCommitCost,
  gitHubTreeRequestCount,
} from "../github/github-adapter";
import {
  commitOnBranch,
  InMemoryGitRepo,
  type StoredCommit,
} from "./in-memory-git-repo";

export interface FakeForgeAdapterShares {
  readonly store: FakeShareStore;
  readonly provider: ShareLocator["provider"];
}

export type FailableOperation =
  | "inspect"
  | "initialize"
  | "getHead"
  | "listTree"
  | "readBlob"
  | "commit"
  | "replaceHistory"
  | "listCommits"
  | "findOldestCommit"
  | "readFileAt"
  | "createShare"
  | "updateShare"
  | "deleteShare";

function toCommitSummary(sha: string, commit: StoredCommit): CommitSummary {
  return {
    sha,
    parents: commit.parent === null ? [] : [commit.parent],
    message: commit.message,
    committedAt: commit.committedAt,
  };
}

type StaleCapableOperation = "initialize" | "commit" | "replaceHistory";

function isStaleCapable(
  operation: FailableOperation,
): operation is StaleCapableOperation {
  return (
    operation === "initialize" ||
    operation === "commit" ||
    operation === "replaceHistory"
  );
}

/**
 * In-memory ForgeAdapter used by tests and the fake-forge mode: no network.
 * Supports a simulated push from another device and one-shot error injection
 * so the layers above the forge can be exercised without a real backend.
 */
export class FakeForgeAdapter implements ForgeAdapter {
  readonly repo: InMemoryGitRepo;
  readonly limits: ForgeWriteLimits = GITHUB_WRITE_LIMITS;
  readonly shareHost: ShareHost;
  private readonly canWrite: boolean;
  private readonly defaultBranch: string;
  private readonly onContentCreatingRequest:
    ((request: ContentCreatingRequest) => void) | undefined;
  private readonly blobCache = new Map<string, string>();
  private readonly blobReadLog: string[] = [];
  private readonly pendingFailures = new Map<
    FailableOperation,
    Array<ForgeError | "stale">
  >();

  constructor(options?: {
    repo?: InMemoryGitRepo;
    canWrite?: boolean;
    defaultBranch?: string;
    onContentCreatingRequest?: (request: ContentCreatingRequest) => void;
    shares?: FakeForgeAdapterShares;
  }) {
    this.repo = options?.repo ?? new InMemoryGitRepo();
    this.canWrite = options?.canWrite ?? true;
    this.defaultBranch = options?.defaultBranch ?? MAIN_BRANCH;
    this.onContentCreatingRequest = options?.onContentCreatingRequest;
    const store = options?.shares?.store ?? createFakeShareStore();
    const provider = options?.shares?.provider ?? "github";
    this.shareHost = {
      create: async (envelope) => {
        if (!this.canWrite) {
          throw new ForgeError("Forbidden");
        }
        this.throwIfFailing("createShare");
        this.report({ operation: "createShare" });
        return store.create(provider, envelope);
      },
      update: async (locator, envelope) => {
        this.throwIfFailing("updateShare");
        this.report({ operation: "updateShare" });
        if (!store.update(locator, envelope)) {
          throw new ForgeError("NotFound");
        }
      },
      delete: async (locator) => {
        this.throwIfFailing("deleteShare");
        this.report({ operation: "deleteShare" });
        store.delete(locator);
      },
    };
  }

  async pushFromAnotherDevice(
    changes: readonly CommitFileChange[],
    message = SAVE_SUBJECT,
  ): Promise<string> {
    return commitOnBranch(this.repo, changes, message);
  }

  failNext(operation: FailableOperation, failure: ForgeError | "stale"): void {
    if (failure === "stale" && !isStaleCapable(operation)) {
      throw new Error(
        `'stale' is only valid for 'initialize', 'commit' and 'replaceHistory', got '${operation}'`,
      );
    }
    const queue = this.pendingFailures.get(operation) ?? [];
    queue.push(failure);
    this.pendingFailures.set(operation, queue);
  }

  private takeFailure(
    operation: FailableOperation,
  ): ForgeError | "stale" | undefined {
    const queue = this.pendingFailures.get(operation);
    return queue?.shift();
  }

  private takeErrorFailure(
    operation: Exclude<FailableOperation, StaleCapableOperation>,
  ): ForgeError | undefined {
    const failure = this.takeFailure(operation);
    if (failure === undefined) {
      return undefined;
    }
    if (failure === "stale") {
      throw new Error(`unreachable: 'stale' queued for '${operation}'`);
    }
    return failure;
  }

  private throwIfFailing(
    operation: Exclude<FailableOperation, StaleCapableOperation>,
  ): void {
    const failure = this.takeErrorFailure(operation);
    if (failure !== undefined) {
      throw failure;
    }
  }

  private takeStaleOrThrow(operation: StaleCapableOperation): boolean {
    const failure = this.takeFailure(operation);
    if (failure === "stale") {
      return true;
    }
    if (failure !== undefined) {
      throw failure;
    }
    return false;
  }

  commitCost(changes: readonly CommitFileChange[]): number {
    return gitHubCommitCost(changes);
  }

  private report(request: ContentCreatingRequest): void {
    this.onContentCreatingRequest?.(request);
  }

  private async readConfigAt(commitSha: string): Promise<string | null> {
    const commit = this.repo.getCommit(commitSha);
    if (commit === undefined) {
      return null;
    }
    const files = this.repo.getTree(commit.tree);
    const sha = files?.get(REPO_CONFIG_PATH);
    if (sha === undefined) {
      return null;
    }
    return this.repo.getBlob(sha) ?? null;
  }

  async inspect(): Promise<RepoInspection> {
    this.throwIfFailing("inspect");

    if (!this.repo.hasCommits()) {
      return { kind: "empty", canWrite: this.canWrite };
    }

    const head = this.repo.getRef(MAIN_BRANCH);
    if (head === undefined) {
      return { kind: "populated", canWrite: this.canWrite, main: null };
    }

    const repoConfigText = await this.readConfigAt(head);
    return {
      kind: "populated",
      canWrite: this.canWrite,
      main: {
        head,
        repoConfigText,
        rootEntries: repoConfigText === null ? this.rootEntriesAt(head) : null,
      },
    };
  }

  private rootEntriesAt(commitSha: string): RootEntry[] {
    const commit = this.repo.getCommit(commitSha);
    const files = commit === undefined ? undefined : this.repo.getTree(commit.tree);
    const entries = new Map<string, RootEntry>();
    for (const path of files?.keys() ?? []) {
      const slash = path.indexOf("/");
      const name = slash === -1 ? path : path.slice(0, slash);
      entries.set(name, { name, type: slash === -1 ? "blob" : "tree" });
    }
    return [...entries.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  async initialize(configText: string, message: string): Promise<CommitResult> {
    if (!this.canWrite) {
      throw new ForgeError("Forbidden");
    }

    if (this.takeStaleOrThrow("initialize")) {
      return { kind: "stale" };
    }

    if (this.repo.hasCommits() || this.repo.getRef(MAIN_BRANCH) !== undefined) {
      return { kind: "stale" };
    }

    this.report({ operation: "initialize" });
    const treeSha = await this.repo.putTree(
      new Map([[REPO_CONFIG_PATH, await this.repo.putBlob(configText)]]),
    );
    const commitSha = await this.repo.putCommit({
      tree: treeSha,
      parent: null,
      message,
    });
    this.repo.setRef(this.defaultBranch, commitSha);

    if (this.defaultBranch !== MAIN_BRANCH) {
      this.report({ operation: "createRef" });
      this.repo.setRef(MAIN_BRANCH, commitSha);
    }

    return { kind: "ok", head: commitSha };
  }

  async getHead(): Promise<string> {
    this.throwIfFailing("getHead");

    const head = this.repo.getRef(MAIN_BRANCH);
    if (head === undefined) {
      throw new ForgeError("NotFound", {
        message: `branch '${MAIN_BRANCH}' not found`,
      });
    }
    return head;
  }

  async listTree(commitSha: string): Promise<TreeEntry[]> {
    this.throwIfFailing("listTree");

    const commit = this.repo.getCommit(commitSha);
    if (commit === undefined) {
      throw new ForgeError("NotFound", {
        message: `unknown commit ${commitSha}`,
      });
    }
    return this.repo.listTreeEntries(commit.tree);
  }

  get blobReads(): readonly string[] {
    return this.blobReadLog;
  }

  async readBlob(sha: string): Promise<string> {
    this.blobReadLog.push(sha);
    const cached = this.blobCache.get(sha);
    if (cached !== undefined) {
      return cached;
    }

    this.throwIfFailing("readBlob");

    const text = this.repo.getBlob(sha);
    if (text === undefined) {
      throw new ForgeError("NotFound", { message: `unknown blob ${sha}` });
    }
    this.blobCache.set(sha, text);
    return text;
  }

  async listCommits(request: ListCommitsRequest): Promise<CommitSummary[]> {
    this.throwIfFailing("listCommits");

    const touching = this.repo.commitsTouching(request.from, request.path);
    if (touching === undefined) {
      throw new ForgeError("NotFound", {
        message: `unknown commit ${request.from}`,
      });
    }
    return touching
      .slice(0, Math.max(0, request.limit))
      .map(([sha, commit]) => toCommitSummary(sha, commit));
  }

  async findOldestCommit(
    request: FindOldestCommitRequest,
  ): Promise<CommitSummary | null> {
    this.throwIfFailing("findOldestCommit");

    const touching = this.repo.commitsTouching(request.from, request.path);
    if (touching === undefined) {
      throw new ForgeError("NotFound", {
        message: `unknown commit ${request.from}`,
      });
    }
    const oldest = touching.at(-1);
    return oldest === undefined ? null : toCommitSummary(...oldest);
  }

  async readFileAt(
    commitSha: string,
    path: string,
  ): Promise<FileAtCommit | null> {
    this.throwIfFailing("readFileAt");

    const blobSha = this.repo.fileAt(commitSha, path);
    const text =
      blobSha === undefined ? undefined : this.repo.getBlob(blobSha);
    if (blobSha === undefined || text === undefined) {
      return null;
    }
    this.blobCache.set(blobSha, text);
    return { blobSha, text };
  }

  async commit(request: CommitRequest): Promise<CommitResult> {
    if (!this.canWrite) {
      throw new ForgeError("Forbidden");
    }

    if (this.takeStaleOrThrow("commit")) {
      return { kind: "stale" };
    }

    for (let i = gitHubTreeRequestCount(request.changes); i > 0; i--) {
      this.report({ operation: "createTree" });
    }
    const parentCommit = this.repo.getCommit(request.parent);
    const newTreeSha = await this.repo.applyChanges(
      parentCommit?.tree ?? null,
      request.changes,
    );

    this.report({ operation: "createCommit" });
    const commitSha = await this.repo.putCommit({
      tree: newTreeSha,
      parent: request.parent,
      message: request.message,
    });

    this.report({ operation: "updateRef" });
    if (this.repo.getRef(MAIN_BRANCH) !== request.parent) {
      return { kind: "stale" };
    }
    this.repo.setRef(MAIN_BRANCH, commitSha);
    return { kind: "ok", head: commitSha };
  }

  async replaceHistory(request: ReplaceHistoryRequest): Promise<CommitResult> {
    if (!this.canWrite) {
      throw new ForgeError("Forbidden");
    }

    if (this.takeStaleOrThrow("replaceHistory")) {
      return { kind: "stale" };
    }

    const head = this.repo.getCommit(request.head);
    if (head === undefined) {
      throw new ForgeError("NotFound", {
        message: `unknown commit ${request.head}`,
      });
    }
    this.report({ operation: "createCommit" });
    const commitSha = await this.repo.putCommit({
      tree: head.tree,
      parent: null,
      message: request.message,
    });

    this.report({ operation: "updateRef" });
    if (this.repo.getRef(MAIN_BRANCH) !== request.head) {
      return { kind: "stale" };
    }
    this.repo.setRef(MAIN_BRANCH, commitSha);
    return { kind: "ok", head: commitSha };
  }
}
