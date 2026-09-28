import { MAIN_BRANCH, REPO_CONFIG_PATH } from "../../format/v1";
import {
  fromBase64,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../../crypto/base64";
import type { RepoCoordinates } from "../../repo-url/parse-repo-url";
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

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

interface GitHubTreeEntryBody {
  readonly path: string;
  readonly mode: "100644" | "040000";
  readonly type: "blob" | "tree";
  readonly sha: string | null;
}

// Decodes GitHub's whitespace-wrapped base64 blob/content payloads. readBlob
// uses a non-fatal TextDecoder, since arbitrary git blobs need not be valid
// UTF-8.
function decodeBase64Content(content: string): Uint8Array {
  return fromBase64(content.replace(/\s+/g, ""));
}

class GitHubAdapter implements ForgeAdapter {
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
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private report(operation: ContentCreatingOperation): void {
    this.onContentCreatingRequest?.({ operation });
  }

  private async send(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<Response> {
    const url = `${API_BASE}/repos/${this.ownerPath}/${this.repoPath}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    const requestInit: RequestInit = {
      method: init.method,
      headers,
      cache: "no-store",
    };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(init.body);
    }

    try {
      return await this.fetchImpl(url, requestInit);
    } catch (cause) {
      throw new ForgeError("Network", { cause });
    }
  }

  private retryAfterMs(response: Response): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) {
        return seconds * 1000;
      }
    }
    const reset = response.headers.get("x-ratelimit-reset");
    if (reset !== null) {
      const resetSeconds = Number(reset);
      if (Number.isFinite(resetSeconds)) {
        return Math.max(0, resetSeconds * 1000 - this.now());
      }
    }
    return 60_000;
  }

  private async errorFor(response: Response): Promise<ForgeError> {
    const status = response.status;
    let message: string | undefined;
    try {
      const body: unknown = await response.clone().json();
      if (
        body !== null &&
        typeof body === "object" &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
      ) {
        message = (body as { message: string }).message;
      }
    } catch {
      // non-JSON or empty body: leave message undefined
    }

    if (status === 401) {
      return new ForgeError("Unauthorized", { status, message });
    }
    if (status === 429) {
      return new ForgeError("RateLimited", {
        status,
        message,
        retryAfterMs: this.retryAfterMs(response),
      });
    }
    if (status === 403) {
      const isRateLimited =
        response.headers.get("retry-after") !== null ||
        response.headers.get("x-ratelimit-remaining") === "0" ||
        (message !== undefined && /rate limit/i.test(message));
      if (isRateLimited) {
        return new ForgeError("RateLimited", {
          status,
          message,
          retryAfterMs: this.retryAfterMs(response),
        });
      }
      return new ForgeError("Forbidden", { status, message });
    }
    if (status === 404) {
      return new ForgeError("NotFound", { status, message });
    }
    return new ForgeError("Server", { status, message });
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
        main: { head, repoConfigText: null },
      };
    }
    if (!configResponse.ok) {
      throw await this.errorFor(configResponse);
    }
    const configBody = (await configResponse.json()) as { content: string };
    const repoConfigText = utf8Decode(decodeBase64Content(configBody.content));
    return { kind: "populated", canWrite, main: { head, repoConfigText } };
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
    const parentResponse = await this.send(`/git/commits/${request.parent}`, {
      method: "GET",
    });
    if (parentResponse.status === 404 || parentResponse.status === 409) {
      throw new ForgeError("NotFound", { status: parentResponse.status });
    }
    if (!parentResponse.ok) {
      throw await this.errorFor(parentResponse);
    }
    const parentBody = (await parentResponse.json()) as {
      tree: { sha: string };
    };
    const baseTree = parentBody.tree.sha;

    const treeEntries: GitHubTreeEntryBody[] = [];
    for (const change of request.changes) {
      treeEntries.push(await this.treeEntryFor(change));
    }

    this.report("createTree");
    const treeResponse = await this.send("/git/trees", {
      method: "POST",
      body: { base_tree: baseTree, tree: treeEntries },
    });
    if (!treeResponse.ok) {
      throw await this.errorFor(treeResponse);
    }
    const treeBody = (await treeResponse.json()) as { sha: string };

    this.report("createCommit");
    const commitResponse = await this.send("/git/commits", {
      method: "POST",
      body: {
        message: request.message,
        tree: treeBody.sha,
        parents: [request.parent],
      },
    });
    if (!commitResponse.ok) {
      throw await this.errorFor(commitResponse);
    }
    const commitBody = (await commitResponse.json()) as { sha: string };

    this.report("updateRef");
    const updateRefResponse = await this.send(
      `/git/refs/heads/${MAIN_BRANCH}`,
      { method: "PATCH", body: { sha: commitBody.sha, force: false } },
    );
    if (updateRefResponse.status === 422) {
      return { kind: "stale" };
    }
    if (!updateRefResponse.ok) {
      throw await this.errorFor(updateRefResponse);
    }
    return { kind: "ok", head: commitBody.sha };
  }

  private async treeEntryFor(
    change: CommitFileChange,
  ): Promise<GitHubTreeEntryBody> {
    if (change.kind === "delete") {
      return { path: change.path, mode: "100644", type: "blob", sha: null };
    }
    if (change.kind === "upsert-blob") {
      return {
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: change.blobSha,
      };
    }

    this.report("createBlob");
    const blobResponse = await this.send("/git/blobs", {
      method: "POST",
      body: { content: change.text, encoding: "utf-8" },
    });
    if (!blobResponse.ok) {
      throw await this.errorFor(blobResponse);
    }
    const blobBody = (await blobResponse.json()) as { sha: string };
    return {
      path: change.path,
      mode: "100644",
      type: "blob",
      sha: blobBody.sha,
    };
  }
}
