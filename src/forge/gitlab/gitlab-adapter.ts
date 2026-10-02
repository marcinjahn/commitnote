import {
  FORMAT_VERSION,
  MAIN_BRANCH,
  REPO_CONFIG_PATH,
  TRAILER,
  UNDO_OUTDATED_SAVE_SUBJECT,
} from "../../format/v1";
import { fromBase64, toBase64 } from "../../crypto/base64";
import type { RepoCoordinates } from "../repo-coordinates";
import {
  GITLAB_DEVELOPER_ACCESS_LEVEL,
  gitLabErrorFor,
  nextPageUrl,
  projectApiPath,
  sendGitLabRequest,
} from "./gitlab-api";
import { ForgeError, isForgeError, withMainUnchanged } from "../errors";
import type {
  AtomicCommitSupport,
  CommitFileChange,
  CommitRequest,
  CommitResult,
  CommitSummary,
  ContentCreatingOperation,
  FileAtCommit,
  ForgeAdapter,
  ForgeAdapterOptions,
  ForgeWriteLimits,
  ListCommitsRequest,
  RepoInspection,
  RootEntry,
  TreeEntry,
} from "../forge-adapter";
import { ROOT_LISTING_LIMIT } from "../forge-adapter";

export interface GitLabAdapterOptions extends ForgeAdapterOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly randomId?: () => string;
}

export function createGitLabAdapter(
  coordinates: Pick<RepoCoordinates, "owner" | "repo">,
  options: GitLabAdapterOptions,
): ForgeAdapter {
  return new GitLabAdapter(coordinates, options);
}

// Below GitLab.com's announced Free-tier limits for authenticated API
// requests (100 per minute, 5000 per hour).
export const GITLAB_WRITE_LIMITS: ForgeWriteLimits = {
  perMinute: 80,
  perHour: 4_000,
};

export const MAX_TREE_PAGES = 100;
const BLOB_FETCH_CONCURRENCY = 8;

export const ATOMIC_BRANCH_PREFIX = "commitnote/tx-";
const ATOMIC_MERGE_REQUEST_TITLE = "commitnote: atomic commit";
export const UNDO_COMMIT_MESSAGE = `${UNDO_OUTDATED_SAVE_SUBJECT}\n\n${TRAILER.format}: ${FORMAT_VERSION}`;
const EMPTY_BLOB_SHA = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
// Create commit, open merge request, merge it.
export const ATOMIC_COMMIT_COST = 3;
export const MAX_MERGE_ATTEMPTS = 6;
export const MERGE_STATUS_POLL_MS = 1_000;
// Leaves an interrupted atomic commit of another device alone long enough
// for it to finish or clean up after itself.
export const ABANDONED_AFTER_MS = 60 * 60 * 1_000;
const GITLAB_MAINTAINER_ACCESS_LEVEL = 40;
const SWEEP_PAGE_SIZE = 100;

const PENDING_MERGE_STATUSES: ReadonlySet<string> = new Set([
  "unchecked",
  "checking",
  "preparing",
  "approvals_syncing",
  "mergeable",
]);
const STALE_MERGE_STATUSES: ReadonlySet<string> = new Set([
  "need_rebase",
  "conflict",
]);

type CommitAction =
  | {
      readonly action: "create" | "update";
      readonly file_path: string;
      readonly content: string;
      readonly encoding: "text" | "base64";
    }
  | {
      readonly action: "move";
      readonly file_path: string;
      readonly previous_path: string;
    }
  | { readonly action: "delete"; readonly file_path: string };

interface ProjectBody {
  readonly empty_repo?: boolean;
  readonly merge_method?: string;
  readonly squash_option?: string;
  readonly only_allow_merge_if_pipeline_succeeds?: boolean;
  readonly approvals_before_merge?: number;
  readonly permissions?: {
    readonly project_access?: { readonly access_level?: number } | null;
    readonly group_access?: { readonly access_level?: number } | null;
  } | null;
}

interface BranchBody {
  readonly name?: string;
  readonly commit: {
    readonly id: string;
    readonly parent_ids?: readonly string[];
    readonly committed_date?: string;
  };
  readonly can_push?: boolean;
}

interface MergeRequestBody {
  readonly iid: number;
  readonly state?: string;
  readonly source_branch?: string;
  readonly created_at?: string;
  readonly detailed_merge_status?: string;
  readonly merge_commit_sha?: string | null;
  readonly squash_commit_sha?: string | null;
}

interface CommitBody {
  readonly id: string;
  readonly parent_ids?: readonly string[];
}

interface CommitListItem extends CommitBody {
  readonly message: string;
  readonly committed_date?: string;
}

interface FileBody {
  readonly blob_id: string;
  readonly encoding?: string;
  readonly content?: string;
}

const MAX_COMMITS_PER_PAGE = 100;

function parseCommittedAt(date: string | undefined): number {
  const time = date === undefined ? NaN : Date.parse(date);
  return Number.isFinite(time) ? time : 0;
}

function accessLevel(project: ProjectBody): number {
  return Math.max(
    project.permissions?.project_access?.access_level ?? 0,
    project.permissions?.group_access?.access_level ?? 0,
  );
}

function hasWriteAccess(project: ProjectBody): boolean {
  return accessLevel(project) >= GITLAB_DEVELOPER_ACCESS_LEVEL;
}

// A fast-forward-only merge request is GitLab's only compare-and-swap on a
// branch: it merges only while main is still the commit's parent.
function atomicCommitSupportFor(project: ProjectBody): AtomicCommitSupport {
  const approvalsRequired = (project.approvals_before_merge ?? 0) > 0;
  if (
    project.merge_method === "ff" &&
    project.squash_option !== "always" &&
    project.only_allow_merge_if_pipeline_succeeds !== true &&
    !approvalsRequired
  ) {
    return { kind: "available" };
  }
  return {
    kind: "needsSetup",
    canConfigure:
      !approvalsRequired &&
      accessLevel(project) >= GITLAB_MAINTAINER_ACCESS_LEVEL,
  };
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ForgeError && error.kind === "Network";
}

function isOlderThan(date: string | undefined, cutoff: number): boolean {
  if (date === undefined) return false;
  const time = Date.parse(date);
  return Number.isFinite(time) && time < cutoff;
}

function hasOnlyParent(
  parentIds: readonly string[] | undefined,
  parent: string,
): boolean {
  return parentIds?.length === 1 && parentIds[0] === parent;
}

type MergeAttempt = "merged" | "refused" | "shaMismatch" | "unknown";

// Validation failures of POST /repository/commits: an action whose
// create/update/delete expectation no longer holds, a missing branch, etc.
function isRejectedCommit(status: number): boolean {
  return status === 400 || status === 409;
}

class GitLabAdapter implements ForgeAdapter {
  readonly limits = GITLAB_WRITE_LIMITS;
  private readonly projectPath: string;
  private readonly accessToken: string;
  private readonly onContentCreatingRequest:
    ((request: { operation: ContentCreatingOperation }) => void) | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly randomId: () => string;
  private atomicSupport: AtomicCommitSupport | undefined;
  private readonly blobCache = new Map<string, string>();
  private readonly treeCache = new Map<string, readonly TreeEntry[]>();

  constructor(
    coordinates: Pick<RepoCoordinates, "owner" | "repo">,
    options: GitLabAdapterOptions,
  ) {
    this.projectPath = projectApiPath(coordinates.owner, coordinates.repo);
    this.accessToken = options.accessToken;
    this.onContentCreatingRequest = options.onContentCreatingRequest;
    // Browsers reject `fetch` called with a non-Window receiver.
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
  }

  commitCost(
    _changes?: readonly CommitFileChange[],
    options?: { readonly atomic?: boolean },
  ): number {
    return options?.atomic === true ? ATOMIC_COMMIT_COST : 1;
  }

  private report(operation: ContentCreatingOperation): void {
    this.onContentCreatingRequest?.({ operation });
  }

  private send(
    pathOrUrl: string,
    init: { method: string; body?: unknown },
  ): Promise<Response> {
    return sendGitLabRequest(
      this.fetchImpl,
      this.accessToken,
      pathOrUrl.startsWith("https://")
        ? pathOrUrl
        : `${this.projectPath}${pathOrUrl}`,
      init,
    );
  }

  private errorFor(response: Response): ForgeError {
    return gitLabErrorFor(response, this.now);
  }

  private async getProject(): Promise<ProjectBody> {
    const response = await this.send("", { method: "GET" });
    if (!response.ok) {
      throw this.errorFor(response);
    }
    return (await response.json()) as ProjectBody;
  }

  private async getMainBranch(): Promise<BranchBody | null> {
    const response = await this.send(
      `/repository/branches/${encodeURIComponent(MAIN_BRANCH)}`,
      { method: "GET" },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw this.errorFor(response);
    }
    return (await response.json()) as BranchBody;
  }

  async inspect(): Promise<RepoInspection> {
    const project = await this.getProject();
    const hasAccess = hasWriteAccess(project);
    if (project.empty_repo === true) {
      return { kind: "empty", canWrite: hasAccess };
    }

    const branch = await this.getMainBranch();
    if (branch === null) {
      return { kind: "populated", canWrite: hasAccess, main: null };
    }
    // can_push also accounts for branch protection, which the access level
    // alone does not.
    const canWrite = hasAccess && branch.can_push !== false;
    const head = branch.commit.id;

    const configResponse = await this.send(
      `/repository/files/${encodeURIComponent(REPO_CONFIG_PATH)}/raw?ref=${encodeURIComponent(head)}`,
      { method: "GET" },
    );
    if (configResponse.status === 404) {
      return {
        kind: "populated",
        canWrite,
        main: {
          head,
          repoConfigText: null,
          rootEntries: await this.listRootEntries(head),
        },
      };
    }
    if (!configResponse.ok) {
      throw this.errorFor(configResponse);
    }
    const repoConfigText = new TextDecoder("utf-8").decode(
      await configResponse.arrayBuffer(),
    );
    return {
      kind: "populated",
      canWrite,
      main: { head, repoConfigText, rootEntries: null },
    };
  }

  private async listRootEntries(commitSha: string): Promise<RootEntry[]> {
    const response = await this.send(
      `/repository/tree?ref=${encodeURIComponent(commitSha)}&per_page=${ROOT_LISTING_LIMIT}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw this.errorFor(response);
    }
    const body = (await response.json()) as readonly {
      name: string;
      type: string;
    }[];
    return body.map((entry) => ({
      name: entry.name,
      // Submodules ("commit") are listed as directories.
      type: entry.type === "blob" ? "blob" : "tree",
    }));
  }

  async initialize(configText: string, message: string): Promise<CommitResult> {
    if ((await this.getProject()).empty_repo !== true) {
      return { kind: "stale" };
    }

    this.report("initialize");
    const response = await this.send("/repository/commits", {
      method: "POST",
      body: {
        branch: MAIN_BRANCH,
        commit_message: message,
        actions: [
          {
            action: "create",
            file_path: REPO_CONFIG_PATH,
            content: configText,
            encoding: "text",
          },
        ],
      },
    });
    if (!response.ok) {
      if (
        isRejectedCommit(response.status) &&
        (await this.getProject()).empty_repo !== true
      ) {
        return { kind: "stale" };
      }
      throw this.errorFor(response);
    }
    const body = (await response.json()) as CommitBody;
    // A non-empty parent list means another client populated the repository
    // between the emptiness check and this commit.
    if ((body.parent_ids ?? []).length > 0) {
      return { kind: "stale" };
    }
    return { kind: "ok", head: body.id };
  }

  async getHead(): Promise<string> {
    const branch = await this.getMainBranch();
    if (branch === null) {
      throw new ForgeError("NotFound", { status: 404 });
    }
    return branch.commit.id;
  }

  async listTree(commitSha: string): Promise<TreeEntry[]> {
    const cached = this.treeCache.get(commitSha);
    if (cached !== undefined) {
      return [...cached];
    }

    const entries: TreeEntry[] = [];
    let url: string | null =
      `/repository/tree?ref=${encodeURIComponent(commitSha)}&recursive=true&per_page=100&pagination=keyset`;
    for (let page = 0; url !== null; page++) {
      if (page === MAX_TREE_PAGES) {
        throw new ForgeError("TreeTruncated");
      }
      const response = await this.send(url, { method: "GET" });
      if (!response.ok) {
        throw this.errorFor(response);
      }
      const body = (await response.json()) as readonly {
        path: string;
        type: string;
        id: string;
      }[];
      for (const entry of body) {
        if (entry.type === "blob" || entry.type === "tree") {
          entries.push({ path: entry.path, type: entry.type, sha: entry.id });
        }
      }
      url = nextPageUrl(response, url);
    }

    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    this.treeCache.set(commitSha, entries);
    return [...entries];
  }

  private async fetchBlob(sha: string): Promise<Response> {
    const response = await this.send(
      `/repository/blobs/${encodeURIComponent(sha)}/raw`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw this.errorFor(response);
    }
    return response;
  }

  async readBlob(sha: string): Promise<string> {
    const cached = this.blobCache.get(sha);
    if (cached !== undefined) {
      return cached;
    }
    const response = await this.fetchBlob(sha);
    const text = new TextDecoder("utf-8").decode(await response.arrayBuffer());
    this.blobCache.set(sha, text);
    return text;
  }

  async listCommits(request: ListCommitsRequest): Promise<CommitSummary[]> {
    const limit = Math.max(0, request.limit);
    const perPage = Math.min(limit, MAX_COMMITS_PER_PAGE);
    const commits: CommitSummary[] = [];
    for (let page = 1; commits.length < limit; page++) {
      const query = new URLSearchParams({
        ref_name: request.from,
        path: request.path,
        per_page: String(perPage),
        page: String(page),
      });
      const response = await this.send(
        `/repository/commits?${query.toString()}`,
        { method: "GET" },
      );
      if (!response.ok) {
        throw this.errorFor(response);
      }
      const body = (await response.json()) as readonly CommitListItem[];
      for (const item of body) {
        commits.push({
          sha: item.id,
          parents: item.parent_ids ?? [],
          message: item.message,
          committedAt: parseCommittedAt(item.committed_date),
        });
      }
      if (body.length < perPage) break;
    }
    // An unknown ref_name can list as empty rather than fail.
    if (commits.length === 0 && limit > 0) {
      await this.requireCommit(request.from);
    }
    return commits.slice(0, limit);
  }

  private async requireCommit(sha: string): Promise<void> {
    const response = await this.send(
      `/repository/commits/${encodeURIComponent(sha)}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw this.errorFor(response);
    }
  }

  async readFileAt(
    commitSha: string,
    path: string,
  ): Promise<FileAtCommit | null> {
    const response = await this.send(
      `/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(commitSha)}`,
      { method: "GET" },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw this.errorFor(response);
    }
    const body = (await response.json()) as FileBody;
    const blobSha = body.blob_id;
    if (body.encoding !== "base64" || body.content === undefined) {
      return { blobSha, text: await this.readBlob(blobSha) };
    }
    const text = new TextDecoder("utf-8").decode(
      fromBase64(body.content.replace(/\s+/g, "")),
    );
    this.blobCache.set(blobSha, text);
    return { blobSha, text };
  }

  // GitLab's commits API has no expected-head parameter (`start_sha` is only
  // accepted for a branch that does not exist yet, or with `force`, which
  // overwrites). So the commit applies to whatever main is: the head is
  // checked just before, and the reported parent just after, which leaves
  // only a narrow race; create/update/delete actions additionally fail when
  // a concurrent commit touched the same file, and a key guard (see
  // `withKeyGuard`) makes the commit fail once main was re-keyed.
  async commit(request: CommitRequest): Promise<CommitResult> {
    if (request.atomic === true) {
      return this.commitAtomically(request);
    }
    if ((await this.getHead()) !== request.parent) {
      return { kind: "stale" };
    }

    const parentEntries = await this.listTree(request.parent);
    const actions = await this.actionsFor(request.changes, parentEntries);
    const guarded = await this.withKeyGuard(request, actions, parentEntries);
    if (guarded === null) {
      return this.commitAtomically({ ...request, atomic: true });
    }

    this.report("createCommit");
    const response = await this.send("/repository/commits", {
      method: "POST",
      body: {
        branch: MAIN_BRANCH,
        commit_message: request.message,
        actions: guarded,
      },
    });
    if (!response.ok) {
      if (
        isRejectedCommit(response.status) &&
        (await this.getHead()) !== request.parent
      ) {
        return { kind: "stale" };
      }
      throw this.errorFor(response);
    }
    const body = (await response.json()) as CommitBody;
    const actualParent = body.parent_ids?.[0];
    if (actualParent !== request.parent) {
      if (
        actualParent !== undefined &&
        (await this.configDiffers(request.parent, actualParent))
      ) {
        await this.undoCommit(actualParent, guarded);
        return { kind: "stale" };
      }
      throw new ForgeError("Server", {
        status: response.status,
        message: "Commit was applied on top of a newer main head",
      });
    }
    return { kind: "ok", head: body.id };
  }

  // Unless the commit already updates, moves or deletes a key-bound file,
  // adds an update of one with its unchanged content: the commit then fails
  // as a whole once a passphrase change has renamed that file. Resolves to
  // null when there is no such file to use, so the commit must go the
  // atomic way to be safe.
  private async withKeyGuard(
    request: CommitRequest,
    actions: readonly CommitAction[],
    parentEntries: readonly TreeEntry[],
  ): Promise<readonly CommitAction[] | null> {
    const candidates = request.keyBoundFiles;
    if (candidates === undefined) return actions;
    const keyBound = new Set(candidates.map((file) => file.path));
    const touched = new Set<string>();
    for (const action of actions) {
      touched.add(action.file_path);
      if (action.action === "move") touched.add(action.previous_path);
      const existingPath =
        action.action === "move" ? action.previous_path : action.file_path;
      if (action.action !== "create" && keyBound.has(existingPath)) {
        return actions;
      }
    }
    const parentBlobs = new Map<string, string>();
    for (const entry of parentEntries) {
      if (entry.type === "blob") parentBlobs.set(entry.path, entry.sha);
    }
    const usable = candidates.filter(
      (file) =>
        !touched.has(file.path) && parentBlobs.get(file.path) === file.blobSha,
    );
    const guard =
      usable.find((file) => file.blobSha === EMPTY_BLOB_SHA) ?? usable[0];
    if (guard === undefined) {
      try {
        if ((await this.atomicCommitSupport()).kind === "available") {
          return null;
        }
      } catch {
        // Falls back to the unguarded commit, checked after the fact.
      }
      return actions;
    }
    const content =
      guard.blobSha === EMPTY_BLOB_SHA
        ? ""
        : toBase64(
            new Uint8Array(
              await (await this.fetchBlob(guard.blobSha)).arrayBuffer(),
            ),
          );
    return [
      ...actions,
      {
        action: "update",
        file_path: guard.path,
        content,
        encoding: guard.blobSha === EMPTY_BLOB_SHA ? "text" : "base64",
      },
    ];
  }

  private async configDiffers(a: string, b: string): Promise<boolean> {
    const configOf = async (sha: string) =>
      (await this.listTree(sha)).find(
        (entry) => entry.type === "blob" && entry.path === REPO_CONFIG_PATH,
      )?.sha;
    return (await configOf(a)) !== (await configOf(b));
  }

  // Reverts a commit that landed on a re-keyed main, restoring every file
  // it touched to its state in `base`, the commit's actual parent.
  private async undoCommit(
    base: string,
    actions: readonly CommitAction[],
  ): Promise<void> {
    const baseBlobs = new Map<string, string>();
    for (const entry of await this.listTree(base)) {
      if (entry.type === "blob") baseBlobs.set(entry.path, entry.sha);
    }
    const restore = async (path: string, action: "create" | "update") => {
      const sha = baseBlobs.get(path);
      if (sha === undefined) {
        return { action: "delete", file_path: path } as const;
      }
      return {
        action,
        file_path: path,
        content: toBase64(
          new Uint8Array(await (await this.fetchBlob(sha)).arrayBuffer()),
        ),
        encoding: "base64",
      } as const;
    };
    const inverse: CommitAction[] = [];
    for (const action of actions) {
      switch (action.action) {
        case "create":
          inverse.push({ action: "delete", file_path: action.file_path });
          break;
        case "update":
          inverse.push(await restore(action.file_path, "update"));
          break;
        case "delete":
          inverse.push(await restore(action.file_path, "create"));
          break;
        case "move":
          inverse.push({
            action: "move",
            file_path: action.previous_path,
            previous_path: action.file_path,
          });
          break;
      }
    }
    this.report("createCommit");
    const response = await this.send("/repository/commits", {
      method: "POST",
      body: {
        branch: MAIN_BRANCH,
        commit_message: UNDO_COMMIT_MESSAGE,
        actions: inverse,
      },
    });
    if (!response.ok) {
      throw new ForgeError("Server", {
        status: response.status,
        message: "A commit that landed on a re-keyed main could not be undone",
      });
    }
  }

  async atomicCommitSupport(): Promise<AtomicCommitSupport> {
    this.atomicSupport ??= atomicCommitSupportFor(await this.getProject());
    return this.atomicSupport;
  }

  async enableAtomicCommits(): Promise<AtomicCommitSupport> {
    const project = await this.getProject();
    const current = atomicCommitSupportFor(project);
    if (current.kind === "available" || !current.canConfigure) {
      this.atomicSupport = current;
      return current;
    }

    const settings: Record<string, unknown> = { merge_method: "ff" };
    if (project.squash_option === "always") {
      settings.squash_option = "default_off";
    }
    if (project.only_allow_merge_if_pipeline_succeeds === true) {
      settings.only_allow_merge_if_pipeline_succeeds = false;
    }
    this.report("updateProject");
    const response = await this.send("", { method: "PUT", body: settings });
    if (!response.ok) {
      throw this.errorFor(response);
    }
    const updated = (await response.json()) as ProjectBody;
    this.atomicSupport = atomicCommitSupportFor({ ...project, ...updated });
    return this.atomicSupport;
  }

  // The commit goes to a fresh branch, where `start_sha` pins its parent,
  // and reaches main only through a fast-forward merge of exactly that SHA.
  private async commitAtomically(
    request: CommitRequest,
  ): Promise<CommitResult> {
    if ((await this.atomicCommitSupport()).kind !== "available") {
      throw new ForgeError("Forbidden", {
        message: "Atomic commits need a GitLab project setting change",
      });
    }
    if ((await this.getHead()) !== request.parent) {
      return { kind: "stale" };
    }

    const parentEntries = await this.listTree(request.parent);
    const actions = await this.actionsFor(request.changes, parentEntries);
    const branch = `${ATOMIC_BRANCH_PREFIX}${this.randomId()}`;
    let commitSha: string;
    let iid: number;
    try {
      commitSha = await this.createTransactionCommit(branch, request, actions);
      iid = await this.openTransactionMergeRequest(branch);
    } catch (error) {
      // Nothing merges the merge request but this adapter, so main stays as
      // it was even if removing the branch fails.
      await this.discardTransaction(branch, null);
      throw error instanceof ForgeError ? withMainUnchanged(error) : error;
    }
    return this.mergeTransaction(branch, iid, commitSha);
  }

  private async createTransactionCommit(
    branch: string,
    request: CommitRequest,
    actions: readonly CommitAction[],
  ): Promise<string> {
    this.report("createCommit");
    let response: Response;
    try {
      response = await this.send("/repository/commits", {
        method: "POST",
        body: {
          branch,
          start_sha: request.parent,
          commit_message: request.message,
          actions,
        },
      });
    } catch (error) {
      if (isNetworkError(error)) {
        const recovered = await this.findTransactionCommit(
          branch,
          request.parent,
        );
        if (recovered !== null) return recovered;
      }
      throw error;
    }
    if (!response.ok) {
      throw this.errorFor(response);
    }
    const body = (await response.json()) as CommitBody;
    if (!hasOnlyParent(body.parent_ids, request.parent)) {
      await this.discardTransaction(branch, null);
      throw new ForgeError("Server", {
        status: response.status,
        message: "Atomic commit was created on an unexpected parent",
      });
    }
    return body.id;
  }

  private async findTransactionCommit(
    branch: string,
    parent: string,
  ): Promise<string | null> {
    const response = await this.send(
      `/repository/branches/${encodeURIComponent(branch)}`,
      { method: "GET" },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw this.errorFor(response);
    }
    const body = (await response.json()) as BranchBody;
    if (!hasOnlyParent(body.commit.parent_ids, parent)) {
      await this.discardTransaction(branch, null);
      return null;
    }
    return body.commit.id;
  }

  private async openTransactionMergeRequest(branch: string): Promise<number> {
    this.report("createMergeRequest");
    let response: Response;
    try {
      response = await this.send("/merge_requests", {
        method: "POST",
        body: {
          source_branch: branch,
          target_branch: MAIN_BRANCH,
          title: ATOMIC_MERGE_REQUEST_TITLE,
          remove_source_branch: true,
          squash: false,
        },
      });
    } catch (error) {
      if (isNetworkError(error)) {
        const existing = await this.findOpenMergeRequest(branch);
        if (existing !== null) return existing;
      }
      throw error;
    }
    // 409: an open merge request for this branch already exists, i.e. an
    // earlier attempt of this request got through.
    if (response.status === 409) {
      const existing = await this.findOpenMergeRequest(branch);
      if (existing !== null) return existing;
    }
    if (!response.ok) {
      await this.discardTransaction(branch, null);
      throw this.errorFor(response);
    }
    return ((await response.json()) as MergeRequestBody).iid;
  }

  private async findOpenMergeRequest(branch: string): Promise<number | null> {
    const response = await this.send(
      `/merge_requests?state=opened&target_branch=${encodeURIComponent(MAIN_BRANCH)}&source_branch=${encodeURIComponent(branch)}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw this.errorFor(response);
    }
    const body = (await response.json()) as readonly MergeRequestBody[];
    return body[0]?.iid ?? null;
  }

  private async mergeTransaction(
    branch: string,
    iid: number,
    commitSha: string,
  ): Promise<CommitResult> {
    for (let attempt = 1; ; attempt++) {
      let outcome: MergeAttempt;
      try {
        outcome = await this.tryMerge(iid, commitSha);
      } catch (error) {
        if (isForgeError(error, "Forbidden")) {
          await this.discardTransaction(branch, iid);
          throw withMainUnchanged(error);
        }
        outcome = "unknown";
      }
      if (outcome === "merged") {
        return { kind: "ok", head: commitSha };
      }
      if (outcome === "shaMismatch") {
        await this.discardTransaction(branch, iid);
        return { kind: "stale" };
      }

      let mergeRequest: MergeRequestBody;
      let onMain = false;
      try {
        mergeRequest = await this.getMergeRequest(iid);
        if (mergeRequest.state !== "merged" && outcome === "unknown") {
          onMain = await this.isOnMain(commitSha);
        }
      } catch {
        return this.settleTransaction(branch, iid, commitSha);
      }
      if (mergeRequest.state === "merged") {
        return this.mergedResult(mergeRequest, commitSha);
      }
      if (onMain) {
        return { kind: "ok", head: commitSha };
      }

      const status = mergeRequest.detailed_merge_status ?? "unchecked";
      // `locked`: GitLab is merging right now.
      const merging = mergeRequest.state === "locked" || status === "locked";
      if (!merging && mergeRequest.state !== "opened") {
        await this.discardTransaction(branch, iid);
        return { kind: "stale" };
      }
      if (!merging && STALE_MERGE_STATUSES.has(status)) {
        await this.discardTransaction(branch, iid);
        return { kind: "stale" };
      }
      if (!merging && !PENDING_MERGE_STATUSES.has(status)) {
        // Some project rule beyond the checked settings blocks the merge.
        this.atomicSupport = undefined;
        await this.discardTransaction(branch, iid);
        throw new ForgeError("Server", {
          message: `GitLab refused the merge (${status})`,
          mainUnchanged: true,
        });
      }
      if (attempt >= MAX_MERGE_ATTEMPTS) {
        if (merging) {
          throw new ForgeError("Network", {
            message: "GitLab was still merging the atomic commit",
          });
        }
        return this.settleTransaction(branch, iid, commitSha);
      }
      await this.sleep(MERGE_STATUS_POLL_MS);
    }
  }

  // Ends a transaction whose merge may or may not have happened: once its
  // merge request is closed and its branch gone it can no longer merge, so
  // main then tells the outcome for good.
  private async settleTransaction(
    branch: string,
    iid: number,
    commitSha: string,
  ): Promise<CommitResult> {
    try {
      if (await this.isOnMain(commitSha))
        return { kind: "ok", head: commitSha };
      await this.closeMergeRequest(iid);
      await this.deleteBranch(branch);
      if (await this.isOnMain(commitSha))
        return { kind: "ok", head: commitSha };
    } catch (error) {
      throw new ForgeError("Network", {
        message: "Could not determine whether the atomic commit landed",
        cause: error,
      });
    }
    throw new ForgeError("Server", {
      message: "GitLab merge did not complete",
      mainUnchanged: true,
    });
  }

  private async tryMerge(iid: number, sha: string): Promise<MergeAttempt> {
    this.report("mergeMergeRequest");
    let response: Response;
    try {
      response = await this.send(`/merge_requests/${iid}/merge`, {
        method: "PUT",
        body: { sha, squash: false, should_remove_source_branch: true },
      });
    } catch (error) {
      if (isNetworkError(error)) return "unknown";
      throw error;
    }
    if (response.ok) {
      const body = (await response.json()) as MergeRequestBody;
      if (body.state !== "merged") return "unknown";
      this.mergedResult(body, sha);
      return "merged";
    }
    if (response.status === 409) return "shaMismatch";
    if ([405, 406, 422].includes(response.status)) return "refused";
    // GitLab answers 401 when the user may not merge into main.
    if (response.status === 401) {
      throw new ForgeError("Forbidden", { status: response.status });
    }
    throw this.errorFor(response);
  }

  private mergedResult(body: MergeRequestBody, sha: string): CommitResult {
    const created = [body.merge_commit_sha, body.squash_commit_sha].filter(
      (value): value is string => typeof value === "string" && value !== sha,
    );
    if (created.length > 0) {
      this.atomicSupport = undefined;
      throw new ForgeError("Server", {
        message:
          "GitLab merged with an extra commit instead of fast-forwarding",
      });
    }
    return { kind: "ok", head: sha };
  }

  private async getMergeRequest(iid: number): Promise<MergeRequestBody> {
    const response = await this.send(`/merge_requests/${iid}`, {
      method: "GET",
    });
    if (!response.ok) {
      throw this.errorFor(response);
    }
    return (await response.json()) as MergeRequestBody;
  }

  private async isOnMain(sha: string): Promise<boolean> {
    const refs = [MAIN_BRANCH, sha]
      .map((ref) => `refs[]=${encodeURIComponent(ref)}`)
      .join("&");
    const response = await this.send(`/repository/merge_base?${refs}`, {
      method: "GET",
    });
    if (!response.ok) {
      throw this.errorFor(response);
    }
    return ((await response.json()) as { id?: string }).id === sha;
  }

  // Best-effort: anything left behind is removed by `sweepAbandoned`.
  private async discardTransaction(
    branch: string,
    iid: number | null,
  ): Promise<void> {
    try {
      if (iid !== null) {
        await this.closeMergeRequest(iid);
      }
      await this.deleteBranch(branch);
    } catch {
      // Left for the next sweep.
    }
  }

  private async closeMergeRequest(iid: number): Promise<void> {
    this.report("closeMergeRequest");
    const response = await this.send(`/merge_requests/${iid}`, {
      method: "PUT",
      body: { state_event: "close" },
    });
    if (!response.ok && response.status !== 404) {
      throw this.errorFor(response);
    }
  }

  private async deleteBranch(branch: string): Promise<void> {
    this.report("deleteRef");
    const response = await this.send(
      `/repository/branches/${encodeURIComponent(branch)}`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404) {
      throw this.errorFor(response);
    }
  }

  async sweepAbandoned(): Promise<void> {
    const cutoff = this.now() - ABANDONED_AFTER_MS;

    const mergeRequestsResponse = await this.send(
      `/merge_requests?state=opened&target_branch=${encodeURIComponent(MAIN_BRANCH)}&per_page=${SWEEP_PAGE_SIZE}`,
      { method: "GET" },
    );
    if (!mergeRequestsResponse.ok) {
      throw this.errorFor(mergeRequestsResponse);
    }
    const mergeRequests =
      (await mergeRequestsResponse.json()) as readonly MergeRequestBody[];
    for (const mergeRequest of mergeRequests) {
      if (
        mergeRequest.source_branch?.startsWith(ATOMIC_BRANCH_PREFIX) === true &&
        isOlderThan(mergeRequest.created_at, cutoff)
      ) {
        await this.closeMergeRequest(mergeRequest.iid);
      }
    }

    const branchesResponse = await this.send(
      `/repository/branches?search=${encodeURIComponent(`^${ATOMIC_BRANCH_PREFIX}`)}&per_page=${SWEEP_PAGE_SIZE}`,
      { method: "GET" },
    );
    if (!branchesResponse.ok) {
      throw this.errorFor(branchesResponse);
    }
    const branches = (await branchesResponse.json()) as readonly BranchBody[];
    for (const branch of branches) {
      if (
        branch.name?.startsWith(ATOMIC_BRANCH_PREFIX) === true &&
        isOlderThan(branch.commit.committed_date, cutoff)
      ) {
        await this.deleteBranch(branch.name);
      }
    }
  }

  private async actionsFor(
    changes: readonly CommitFileChange[],
    parentEntries: readonly TreeEntry[],
  ): Promise<CommitAction[]> {
    const parentBlobs = new Map<string, string>();
    for (const entry of parentEntries) {
      if (entry.type === "blob") parentBlobs.set(entry.path, entry.sha);
    }
    const existing = new Set(parentBlobs.keys());

    // A deleted file whose blob is re-added elsewhere becomes a `move`, which
    // needs no content upload.
    const movableFrom = new Map<string, string[]>();
    for (const change of changes) {
      const sha =
        change.kind === "delete" ? parentBlobs.get(change.path) : undefined;
      if (sha !== undefined) {
        movableFrom.set(sha, [...(movableFrom.get(sha) ?? []), change.path]);
      }
    }
    const movedAway = new Set<string>();
    const moveSources = new Map<CommitFileChange, string>();
    for (const change of changes) {
      if (change.kind !== "upsert-blob" || parentBlobs.has(change.path)) {
        continue;
      }
      const source = movableFrom.get(change.blobSha)?.shift();
      if (source !== undefined) {
        moveSources.set(change, source);
        movedAway.add(source);
      }
    }

    const blobContents = await this.blobContentsFor(
      changes.filter(
        (
          change,
        ): change is Extract<CommitFileChange, { kind: "upsert-blob" }> =>
          change.kind === "upsert-blob" && !moveSources.has(change),
      ),
    );

    const actions: CommitAction[] = [];
    for (const change of changes) {
      if (change.kind === "delete") {
        if (movedAway.has(change.path)) continue;
        actions.push({ action: "delete", file_path: change.path });
        existing.delete(change.path);
        continue;
      }
      const source = moveSources.get(change);
      if (source !== undefined) {
        actions.push({
          action: "move",
          file_path: change.path,
          previous_path: source,
        });
        existing.delete(source);
        existing.add(change.path);
        continue;
      }
      const action = existing.has(change.path) ? "update" : "create";
      actions.push(
        change.kind === "upsert-text"
          ? {
              action,
              file_path: change.path,
              content: change.text,
              encoding: "text",
            }
          : {
              action,
              file_path: change.path,
              content: blobContents.get(change.blobSha) ?? "",
              encoding: "base64",
            },
      );
      existing.add(change.path);
    }
    return actions;
  }

  private async blobContentsFor(
    changes: readonly Extract<CommitFileChange, { kind: "upsert-blob" }>[],
  ): Promise<Map<string, string>> {
    const shas = [...new Set(changes.map((change) => change.blobSha))];
    const contents = new Map<string, string>();
    for (let i = 0; i < shas.length; i += BLOB_FETCH_CONCURRENCY) {
      await Promise.all(
        shas.slice(i, i + BLOB_FETCH_CONCURRENCY).map(async (sha) => {
          const response = await this.fetchBlob(sha);
          contents.set(
            sha,
            toBase64(new Uint8Array(await response.arrayBuffer())),
          );
        }),
      );
    }
    return contents;
  }
}
