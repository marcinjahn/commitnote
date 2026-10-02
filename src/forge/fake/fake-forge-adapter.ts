import { MAIN_BRANCH, REPO_CONFIG_PATH, SAVE_SUBJECT } from "../../format/v1";
import { ForgeError } from "../errors";
import type {
  CommitFileChange,
  CommitRequest,
  CommitResult,
  CommitSummary,
  ContentCreatingRequest,
  FileAtCommit,
  ForgeAdapter,
  ForgeWriteLimits,
  ListCommitsRequest,
  ReplaceHistoryRequest,
  RepoInspection,
  RootEntry,
  TreeEntry,
} from "../forge-adapter";
import {
  GITHUB_WRITE_LIMITS,
  gitHubCommitCost,
  gitHubTreeRequestCount,
} from "../github/github-adapter";
import { InMemoryGitRepo } from "./in-memory-git-repo";

type FailableOperation =
  | "inspect"
  | "initialize"
  | "getHead"
  | "listTree"
  | "readBlob"
  | "commit"
  | "replaceHistory"
  | "listCommits"
  | "readFileAt";

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
 * In-memory ForgeAdapter for tests: no network, no GitHub. Supports a
 * simulated push from another device and one-shot error injection so the
 * layers above the forge can be exercised without a real backend.
 */
export class FakeForgeAdapter implements ForgeAdapter {
  readonly repo: InMemoryGitRepo;
  readonly limits: ForgeWriteLimits = GITHUB_WRITE_LIMITS;
  private readonly canWrite: boolean;
  private readonly defaultBranch: string;
  private readonly onContentCreatingRequest:
    ((request: ContentCreatingRequest) => void) | undefined;
  private readonly blobCache = new Map<string, string>();
  private readonly pendingFailures = new Map<
    FailableOperation,
    Array<ForgeError | "stale">
  >();

  constructor(options?: {
    repo?: InMemoryGitRepo;
    canWrite?: boolean;
    defaultBranch?: string;
    onContentCreatingRequest?: (request: ContentCreatingRequest) => void;
  }) {
    this.repo = options?.repo ?? new InMemoryGitRepo();
    this.canWrite = options?.canWrite ?? true;
    this.defaultBranch = options?.defaultBranch ?? MAIN_BRANCH;
    this.onContentCreatingRequest = options?.onContentCreatingRequest;
  }

  async pushFromAnotherDevice(
    changes: readonly CommitFileChange[],
    message = SAVE_SUBJECT,
  ): Promise<string> {
    const parent = this.repo.getRef(MAIN_BRANCH) ?? null;
    const parentCommit =
      parent === null ? undefined : this.repo.getCommit(parent);
    const treeSha = await this.repo.applyChanges(
      parentCommit?.tree ?? null,
      changes,
    );
    const commitSha = await this.repo.putCommit({
      tree: treeSha,
      parent,
      message,
    });
    this.repo.setRef(MAIN_BRANCH, commitSha);
    return commitSha;
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
    const failure = this.takeErrorFailure("inspect");
    if (failure !== undefined) {
      throw failure;
    }

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

    const failure = this.takeFailure("initialize");
    if (failure === "stale") {
      return { kind: "stale" };
    }
    if (failure !== undefined) {
      throw failure;
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
    const failure = this.takeErrorFailure("getHead");
    if (failure !== undefined) {
      throw failure;
    }

    const head = this.repo.getRef(MAIN_BRANCH);
    if (head === undefined) {
      throw new ForgeError("NotFound", {
        message: `branch '${MAIN_BRANCH}' not found`,
      });
    }
    return head;
  }

  async listTree(commitSha: string): Promise<TreeEntry[]> {
    const failure = this.takeErrorFailure("listTree");
    if (failure !== undefined) {
      throw failure;
    }

    const commit = this.repo.getCommit(commitSha);
    if (commit === undefined) {
      throw new ForgeError("NotFound", {
        message: `unknown commit ${commitSha}`,
      });
    }
    return this.repo.listTreeEntries(commit.tree);
  }

  async readBlob(sha: string): Promise<string> {
    const cached = this.blobCache.get(sha);
    if (cached !== undefined) {
      return cached;
    }

    const failure = this.takeErrorFailure("readBlob");
    if (failure !== undefined) {
      throw failure;
    }

    const text = this.repo.getBlob(sha);
    if (text === undefined) {
      throw new ForgeError("NotFound", { message: `unknown blob ${sha}` });
    }
    this.blobCache.set(sha, text);
    return text;
  }

  async listCommits(request: ListCommitsRequest): Promise<CommitSummary[]> {
    const failure = this.takeErrorFailure("listCommits");
    if (failure !== undefined) {
      throw failure;
    }

    const touching = this.repo.commitsTouching(request.from, request.path);
    if (touching === undefined) {
      throw new ForgeError("NotFound", {
        message: `unknown commit ${request.from}`,
      });
    }
    return touching.slice(0, Math.max(0, request.limit)).map(([sha, commit]) => ({
      sha,
      parents: commit.parent === null ? [] : [commit.parent],
      message: commit.message,
      committedAt: commit.committedAt,
    }));
  }

  async readFileAt(
    commitSha: string,
    path: string,
  ): Promise<FileAtCommit | null> {
    const failure = this.takeErrorFailure("readFileAt");
    if (failure !== undefined) {
      throw failure;
    }

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

    const failure = this.takeFailure("commit");
    if (failure === "stale") {
      return { kind: "stale" };
    }
    if (failure !== undefined) {
      throw failure;
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

    const failure = this.takeFailure("replaceHistory");
    if (failure === "stale") {
      return { kind: "stale" };
    }
    if (failure !== undefined) {
      throw failure;
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
