import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import { toBase64 } from "../../crypto/base64";
import type { RepoCoordinates } from "../repo-coordinates";
import {
  GITLAB_DEVELOPER_ACCESS_LEVEL,
  gitLabErrorFor,
  nextPageUrl,
  projectApiPath,
  sendGitLabRequest,
} from "./gitlab-api";
import { ForgeError } from "../errors";
import type {
  CommitFileChange,
  CommitRequest,
  CommitResult,
  ContentCreatingOperation,
  ForgeAdapter,
  ForgeAdapterOptions,
  RepoInspection,
  TreeEntry,
} from "../forge-adapter";

export interface GitLabAdapterOptions extends ForgeAdapterOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createGitLabAdapter(
  coordinates: Pick<RepoCoordinates, "owner" | "repo">,
  options: GitLabAdapterOptions,
): ForgeAdapter {
  return new GitLabAdapter(coordinates, options);
}

export const MAX_TREE_PAGES = 100;
const BLOB_FETCH_CONCURRENCY = 8;

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
  readonly permissions?: {
    readonly project_access?: { readonly access_level?: number } | null;
    readonly group_access?: { readonly access_level?: number } | null;
  } | null;
}

interface BranchBody {
  readonly commit: { readonly id: string };
  readonly can_push?: boolean;
}

interface CommitBody {
  readonly id: string;
  readonly parent_ids?: readonly string[];
}

function hasWriteAccess(project: ProjectBody): boolean {
  const levels = [
    project.permissions?.project_access?.access_level ?? 0,
    project.permissions?.group_access?.access_level ?? 0,
  ];
  return Math.max(...levels) >= GITLAB_DEVELOPER_ACCESS_LEVEL;
}

// Validation failures of POST /repository/commits: an action whose
// create/update/delete expectation no longer holds, a missing branch, etc.
function isRejectedCommit(status: number): boolean {
  return status === 400 || status === 409;
}

class GitLabAdapter implements ForgeAdapter {
  private readonly projectPath: string;
  private readonly accessToken: string;
  private readonly onContentCreatingRequest:
    ((request: { operation: ContentCreatingOperation }) => void) | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
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
        main: { head, repoConfigText: null },
      };
    }
    if (!configResponse.ok) {
      throw this.errorFor(configResponse);
    }
    const repoConfigText = new TextDecoder("utf-8").decode(
      await configResponse.arrayBuffer(),
    );
    return { kind: "populated", canWrite, main: { head, repoConfigText } };
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

  // GitLab's commits API has no expected-head parameter (`start_sha` is only
  // accepted for a branch that does not exist yet, or with `force`, which
  // overwrites). So the commit applies to whatever main is: the head is
  // checked just before, and the reported parent just after, which leaves
  // only a narrow race; create/update/delete actions additionally fail when
  // a concurrent commit touched the same file.
  async commit(request: CommitRequest): Promise<CommitResult> {
    if ((await this.getHead()) !== request.parent) {
      return { kind: "stale" };
    }

    const parentEntries = await this.listTree(request.parent);
    const actions = await this.actionsFor(request.changes, parentEntries);

    this.report("createCommit");
    const response = await this.send("/repository/commits", {
      method: "POST",
      body: {
        branch: MAIN_BRANCH,
        commit_message: request.message,
        actions,
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
    if (body.parent_ids?.[0] !== request.parent) {
      throw new ForgeError("Server", {
        status: response.status,
        message: "Commit was applied on top of a newer main head",
      });
    }
    return { kind: "ok", head: body.id };
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
