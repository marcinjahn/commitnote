import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import {
  fromBase64,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../../crypto/base64";
import type { RepoCoordinates } from "../repo-coordinates";
import { gitHubErrorFor, sendGitHubRequest } from "./github-api";
import { ForgeError, isForgeError, withMainUnchanged } from "../errors";
import type {
  CommitFileChange,
  CommitRequest,
  CommitResult,
  ContentCreatingOperation,
  ForgeAdapter,
  ForgeAdapterOptions,
  ForgeWriteLimits,
  ReplaceHistoryRequest,
  RepoInspection,
  RootEntry,
  TreeEntry,
} from "../forge-adapter";

export interface GitHubAdapterOptions extends ForgeAdapterOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createGitHubAdapter(
  coordinates: Pick<RepoCoordinates, "owner" | "repo">,
  options: GitHubAdapterOptions,
): ForgeAdapter {
  return new GitHubAdapter(coordinates, options);
}

// Within GitHub's secondary limits for content-creating requests (80 per
// minute, 500 per hour).
export const GITHUB_WRITE_LIMITS: ForgeWriteLimits = {
  perMinute: 60,
  perHour: 400,
};

// GitHub documents no size limit for POST /git/trees, but very large
// requests time out; bigger change sets are split into chained tree requests
// that still end in one commit.
export const MAX_TREE_REQUEST_BYTES = 1_000_000;
export const MAX_TREE_REQUEST_ENTRIES = 500;

type GitHubTreeEntryBody = {
  readonly path: string;
  readonly mode: "100644";
  readonly type: "blob";
} & ({ readonly sha: string | null } | { readonly content: string });

function treeEntryFor(change: CommitFileChange): GitHubTreeEntryBody {
  const base = { path: change.path, mode: "100644", type: "blob" } as const;
  switch (change.kind) {
    case "delete":
      return { ...base, sha: null };
    case "upsert-blob":
      return { ...base, sha: change.blobSha };
    case "upsert-text":
      return { ...base, content: change.text };
  }
}

function chunkTreeEntries(
  entries: readonly GitHubTreeEntryBody[],
): GitHubTreeEntryBody[][] {
  const chunks: GitHubTreeEntryBody[][] = [];
  let current: GitHubTreeEntryBody[] = [];
  let currentBytes = 0;
  for (const entry of entries) {
    const bytes = utf8Encode(JSON.stringify(entry)).byteLength;
    if (
      current.length > 0 &&
      (current.length >= MAX_TREE_REQUEST_ENTRIES ||
        currentBytes + bytes > MAX_TREE_REQUEST_BYTES)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += bytes;
  }
  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

export function gitHubTreeRequestCount(
  changes: readonly CommitFileChange[],
): number {
  return chunkTreeEntries(changes.map(treeEntryFor)).length;
}

export function gitHubCommitCost(changes: readonly CommitFileChange[]): number {
  return gitHubTreeRequestCount(changes) + 2;
}

// Decodes GitHub's whitespace-wrapped base64 blob/content payloads. readBlob
// uses a non-fatal TextDecoder, since arbitrary git blobs need not be valid
// UTF-8.
function decodeBase64Content(content: string): Uint8Array {
  return fromBase64(content.replace(/\s+/g, ""));
}

class GitHubAdapter implements ForgeAdapter {
  readonly limits = GITHUB_WRITE_LIMITS;
  private readonly ownerPath: string;
  private readonly repoPath: string;
  private readonly accessToken: string;
  private readonly onContentCreatingRequest:
    ((request: { operation: ContentCreatingOperation }) => void) | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly blobCache = new Map<string, string>();

  constructor(
    coordinates: Pick<RepoCoordinates, "owner" | "repo">,
    options: GitHubAdapterOptions,
  ) {
    this.ownerPath = encodeURIComponent(coordinates.owner);
    this.repoPath = encodeURIComponent(coordinates.repo);
    this.accessToken = options.accessToken;
    this.onContentCreatingRequest = options.onContentCreatingRequest;
    // Browsers reject `fetch` called with a non-Window receiver (Illegal
    // invocation), so the default resolves and calls globalThis.fetch
    // unbound, at call time.
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  commitCost(changes: readonly CommitFileChange[]): number {
    return gitHubCommitCost(changes);
  }

  private report(operation: ContentCreatingOperation): void {
    this.onContentCreatingRequest?.({ operation });
  }

  private send(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<Response> {
    return sendGitHubRequest(
      this.fetchImpl,
      this.accessToken,
      `/repos/${this.ownerPath}/${this.repoPath}${path}`,
      init,
    );
  }

  private errorFor(response: Response): Promise<ForgeError> {
    return gitHubErrorFor(response, this.now);
  }

  async inspect(): Promise<RepoInspection> {
    const repoResponse = await this.send("", { method: "GET" });
    if (!repoResponse.ok) {
      throw await this.errorFor(repoResponse);
    }
    const repoBody = (await repoResponse.json()) as {
      permissions?: { push?: boolean };
    };
    const canWrite = repoBody.permissions?.push === true;

    const refResponse = await this.send(`/git/ref/heads/${MAIN_BRANCH}`, {
      method: "GET",
    });
    if (refResponse.status === 409) {
      return { kind: "empty", canWrite };
    }
    if (refResponse.status === 404) {
      return { kind: "populated", canWrite, main: null };
    }
    if (!refResponse.ok) {
      throw await this.errorFor(refResponse);
    }
    const refBody = (await refResponse.json()) as { object: { sha: string } };
    const head = refBody.object.sha;

    const configResponse = await this.send(
      `/contents/${REPO_CONFIG_PATH}?ref=${head}`,
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
      throw await this.errorFor(configResponse);
    }
    const configBody = (await configResponse.json()) as { content: string };
    const repoConfigText = utf8Decode(decodeBase64Content(configBody.content));
    return {
      kind: "populated",
      canWrite,
      main: { head, repoConfigText, rootEntries: null },
    };
  }

  private async listRootEntries(commitSha: string): Promise<RootEntry[]> {
    const response = await this.send(`/git/trees/${commitSha}`, {
      method: "GET",
    });
    if (!response.ok) {
      throw await this.errorFor(response);
    }
    const body = (await response.json()) as {
      tree: readonly { path: string; type: string }[];
    };
    return body.tree.map((entry) => ({
      name: entry.path,
      // Submodules ("commit") are listed as directories.
      type: entry.type === "blob" ? "blob" : "tree",
    }));
  }

  async initialize(configText: string, message: string): Promise<CommitResult> {
    this.report("initialize");
    const putResponse = await this.send(`/contents/${REPO_CONFIG_PATH}`, {
      method: "PUT",
      body: {
        message,
        content: toBase64(utf8Encode(configText)),
      },
    });
    if (putResponse.status === 409 || putResponse.status === 422) {
      return { kind: "stale" };
    }
    if (!putResponse.ok) {
      throw await this.errorFor(putResponse);
    }
    const putBody = (await putResponse.json()) as { commit: { sha: string } };
    const sha = putBody.commit.sha;

    const refResponse = await this.send(`/git/ref/heads/${MAIN_BRANCH}`, {
      method: "GET",
    });
    if (refResponse.status === 404) {
      this.report("createRef");
      const createRefResponse = await this.send("/git/refs", {
        method: "POST",
        body: { ref: `refs/heads/${MAIN_BRANCH}`, sha },
      });
      if (createRefResponse.status === 422) {
        return { kind: "stale" };
      }
      if (!createRefResponse.ok) {
        throw await this.errorFor(createRefResponse);
      }
      return { kind: "ok", head: sha };
    }
    if (!refResponse.ok) {
      throw await this.errorFor(refResponse);
    }
    const refBody = (await refResponse.json()) as { object: { sha: string } };
    if (refBody.object.sha !== sha) {
      return { kind: "stale" };
    }
    return { kind: "ok", head: sha };
  }

  async getHead(): Promise<string> {
    const response = await this.send(`/git/ref/heads/${MAIN_BRANCH}`, {
      method: "GET",
    });
    if (response.status === 404 || response.status === 409) {
      throw new ForgeError("NotFound", { status: response.status });
    }
    if (!response.ok) {
      throw await this.errorFor(response);
    }
    const body = (await response.json()) as { object: { sha: string } };
    return body.object.sha;
  }

  async listTree(commitSha: string): Promise<TreeEntry[]> {
    const commitResponse = await this.send(`/git/commits/${commitSha}`, {
      method: "GET",
    });
    if (commitResponse.status === 404 || commitResponse.status === 409) {
      throw new ForgeError("NotFound", { status: commitResponse.status });
    }
    if (!commitResponse.ok) {
      throw await this.errorFor(commitResponse);
    }
    const commitBody = (await commitResponse.json()) as {
      tree: { sha: string };
    };

    const treeResponse = await this.send(
      `/git/trees/${commitBody.tree.sha}?recursive=1`,
      { method: "GET" },
    );
    if (!treeResponse.ok) {
      throw await this.errorFor(treeResponse);
    }
    const treeBody = (await treeResponse.json()) as {
      truncated: boolean;
      tree: readonly { path: string; type: string; sha: string }[];
    };
    if (treeBody.truncated) {
      throw new ForgeError("TreeTruncated", { status: treeResponse.status });
    }

    const entries: TreeEntry[] = treeBody.tree
      .filter(
        (
          entry,
        ): entry is { path: string; type: "blob" | "tree"; sha: string } =>
          entry.type === "blob" || entry.type === "tree",
      )
      .map((entry) => ({ path: entry.path, type: entry.type, sha: entry.sha }));
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return entries;
  }

  async readBlob(sha: string): Promise<string> {
    const cached = this.blobCache.get(sha);
    if (cached !== undefined) {
      return cached;
    }

    const response = await this.send(`/git/blobs/${sha}`, { method: "GET" });
    if (response.status === 404 || response.status === 409) {
      throw new ForgeError("NotFound", { status: response.status });
    }
    if (!response.ok) {
      throw await this.errorFor(response);
    }
    const body = (await response.json()) as { content: string };
    const text = new TextDecoder("utf-8").decode(
      decodeBase64Content(body.content),
    );
    this.blobCache.set(sha, text);
    return text;
  }

  async commit(request: CommitRequest): Promise<CommitResult> {
    let commitSha: string;
    try {
      commitSha = await this.createCommitObject(request);
    } catch (error) {
      // Only the ref update below touches main.
      throw isForgeError(error) ? withMainUnchanged(error) : error;
    }

    this.report("updateRef");
    let updateRefResponse: Response;
    try {
      updateRefResponse = await this.send(`/git/refs/heads/${MAIN_BRANCH}`, {
        method: "PATCH",
        body: { sha: commitSha, force: false },
      });
    } catch (error) {
      if (!isForgeError(error, "Network")) throw error;
      return this.settleRefUpdate(request.parent, commitSha, error);
    }
    if (updateRefResponse.status === 422) {
      return { kind: "stale" };
    }
    if (!updateRefResponse.ok) {
      const error = await this.errorFor(updateRefResponse);
      if (updateRefResponse.status >= 500) {
        return this.settleRefUpdate(request.parent, commitSha, error);
      }
      throw withMainUnchanged(error);
    }
    return { kind: "ok", head: commitSha };
  }

  // The REST API has no compare-and-swap for a forced ref update, so main is
  // checked just before it. After a passphrase change only a device that
  // already has the new passphrase could commit in between.
  async replaceHistory(request: ReplaceHistoryRequest): Promise<CommitResult> {
    let commitSha: string;
    try {
      commitSha = await this.createRootCommit(request);
      if ((await this.getHead()) !== request.head) return { kind: "stale" };
    } catch (error) {
      throw isForgeError(error) ? withMainUnchanged(error) : error;
    }

    this.report("updateRef");
    let updateRefResponse: Response;
    try {
      updateRefResponse = await this.send(`/git/refs/heads/${MAIN_BRANCH}`, {
        method: "PATCH",
        body: { sha: commitSha, force: true },
      });
    } catch (error) {
      if (!isForgeError(error, "Network")) throw error;
      return this.settleRefUpdate(request.head, commitSha, error);
    }
    if (!updateRefResponse.ok) {
      const error = await this.errorFor(updateRefResponse);
      if (updateRefResponse.status >= 500) {
        return this.settleRefUpdate(request.head, commitSha, error);
      }
      throw withMainUnchanged(error);
    }
    return { kind: "ok", head: commitSha };
  }

  private async treeOf(commitSha: string): Promise<string> {
    const response = await this.send(`/git/commits/${commitSha}`, {
      method: "GET",
    });
    if (response.status === 404 || response.status === 409) {
      throw new ForgeError("NotFound", { status: response.status });
    }
    if (!response.ok) {
      throw await this.errorFor(response);
    }
    return ((await response.json()) as { tree: { sha: string } }).tree.sha;
  }

  private async createRootCommit(
    request: ReplaceHistoryRequest,
  ): Promise<string> {
    const tree = await this.treeOf(request.head);
    this.report("createCommit");
    const response = await this.send("/git/commits", {
      method: "POST",
      body: { message: request.message, tree, parents: [] },
    });
    if (!response.ok) {
      throw await this.errorFor(response);
    }
    return ((await response.json()) as { sha: string }).sha;
  }

  private async createCommitObject(request: CommitRequest): Promise<string> {
    let tree = await this.treeOf(request.parent);
    for (const chunk of chunkTreeEntries(request.changes.map(treeEntryFor))) {
      this.report("createTree");
      const treeResponse = await this.send("/git/trees", {
        method: "POST",
        body: { base_tree: tree, tree: chunk },
      });
      if (!treeResponse.ok) {
        throw await this.errorFor(treeResponse);
      }
      tree = ((await treeResponse.json()) as { sha: string }).sha;
    }

    this.report("createCommit");
    const commitResponse = await this.send("/git/commits", {
      method: "POST",
      body: {
        message: request.message,
        tree,
        parents: [request.parent],
      },
    });
    if (!commitResponse.ok) {
      throw await this.errorFor(commitResponse);
    }
    return ((await commitResponse.json()) as { sha: string }).sha;
  }

  // A ref update whose response was lost either happened or never will, so
  // main tells which.
  private async settleRefUpdate(
    parent: string,
    commitSha: string,
    error: ForgeError,
  ): Promise<CommitResult> {
    let head: string;
    try {
      head = await this.getHead();
    } catch {
      throw error;
    }
    if (head === commitSha) return { kind: "ok", head };
    if (head === parent) throw withMainUnchanged(error);
    throw error;
  }
}
