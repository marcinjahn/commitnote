import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import { fromBase64, utf8Decode } from "../../../crypto/base64";
import type { CommitFileChange, TreeEntry } from "../../forge-adapter";
import { InMemoryGitRepo } from "../../fake/in-memory-git-repo";

export interface MockGitLabRepoOptions {
  /** Full project path, e.g. "group/sub/notes". */
  projectPath: string;
  token: string;
  canWrite?: boolean;
  defaultBranch?: string;
}

export type MockFailure =
  | {
      status: 401 | 403 | 404 | 429 | 500 | 502;
      body?: unknown;
      headers?: Record<string, string>;
    }
  | { network: true };

interface FailureMatch {
  readonly method: string;
  readonly pathPattern: RegExp;
}

interface QueuedFailure {
  readonly match: FailureMatch;
  readonly failure: MockFailure;
}

interface CommitActionBody {
  readonly action?: string;
  readonly file_path?: string;
  readonly previous_path?: string;
  readonly content?: string;
  readonly encoding?: "text" | "base64";
}

interface CommitBody {
  readonly branch?: string;
  readonly commit_message?: string;
  readonly start_branch?: string;
  readonly start_sha?: string;
  readonly force?: boolean;
  readonly actions?: readonly CommitActionBody[];
}

const API_PREFIX = "/api/v4";
const DEVELOPER_ACCESS_LEVEL = 30;
const REPORTER_ACCESS_LEVEL = 20;

function jsonResponse(
  body: JsonBodyType,
  status: number,
  headers?: Record<string, string>,
): Response {
  return HttpResponse.json(body, { status, headers });
}

function rawResponse(text: string): Response {
  return new HttpResponse(new TextEncoder().encode(text), {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

class CommitRejected extends Error {}

/**
 * Stateful, test-only mock of the GitLab REST endpoints the GitLab forge
 * adapter uses, backed by an InMemoryGitRepo. Follows GitLab's commit
 * creation rules: `start_sha` names the base of a branch that does not exist
 * yet (or needs `force`), and without it a commit applies to the branch's
 * current head. Registered as MSW handlers; imported only from tests.
 */
export class MockGitLabRepo {
  readonly git = new InMemoryGitRepo();
  readonly requests: { method: string; path: string }[] = [];
  treePageSize = 100;

  private readonly projectPath: string;
  private readonly token: string;
  private readonly canWrite: boolean;
  private readonly defaultBranch: string;
  private readonly failureQueue: QueuedFailure[] = [];

  constructor(options: MockGitLabRepoOptions) {
    this.projectPath = options.projectPath;
    this.token = options.token;
    this.canWrite = options.canWrite ?? true;
    this.defaultBranch = options.defaultBranch ?? "main";
  }

  failNext(match: FailureMatch, failure: MockFailure): void {
    this.failureQueue.push({ match, failure });
  }

  handlers(): HttpHandler[] {
    return [
      http.all("https://gitlab.com/api/v4/projects/*", ({ request }) =>
        this.handle(request),
      ),
    ];
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = `${url.pathname}${url.search}`;
    this.requests.push({ method, path });

    const queuedIndex = this.failureQueue.findIndex(
      (queued) =>
        queued.match.method.toUpperCase() === method &&
        queued.match.pathPattern.test(path),
    );
    if (queuedIndex !== -1) {
      const [queued] = this.failureQueue.splice(queuedIndex, 1);
      return this.respondFailure(queued.failure);
    }

    if (request.headers.get("authorization") !== `Bearer ${this.token}`) {
      return jsonResponse({ message: "401 Unauthorized" }, 401);
    }

    const projectMatch = new RegExp(
      `^${API_PREFIX}/projects/([^/]+)(/.*)?$`,
    ).exec(url.pathname);
    if (
      projectMatch === null ||
      decodeURIComponent(projectMatch[1]) !== this.projectPath
    ) {
      return jsonResponse({ message: "404 Project Not Found" }, 404);
    }

    return this.route(method, projectMatch[2] ?? "", url, request);
  }

  private respondFailure(failure: MockFailure): Response {
    if ("network" in failure) {
      return HttpResponse.error();
    }
    return jsonResponse(
      (failure.body ?? { message: "Injected failure" }) as JsonBodyType,
      failure.status,
      failure.headers,
    );
  }

  private isEmpty(): boolean {
    return !this.git.hasCommits();
  }

  private resolveCommit(ref: string | null): string | undefined {
    if (ref === null) return undefined;
    return (
      this.git.getRef(ref) ??
      (this.git.getCommit(ref) !== undefined ? ref : undefined)
    );
  }

  private async entriesAt(
    ref: string | null,
  ): Promise<TreeEntry[] | undefined> {
    const sha = this.resolveCommit(ref);
    const commit = sha === undefined ? undefined : this.git.getCommit(sha);
    return commit === undefined
      ? undefined
      : this.git.listTreeEntries(commit.tree);
  }

  private async route(
    method: string,
    rest: string,
    url: URL,
    request: Request,
  ): Promise<Response> {
    if (method === "GET" && rest === "") {
      return jsonResponse(
        {
          id: 1,
          path_with_namespace: this.projectPath,
          default_branch: this.isEmpty() ? null : this.defaultBranch,
          empty_repo: this.isEmpty(),
          permissions: {
            project_access: {
              access_level: this.canWrite
                ? DEVELOPER_ACCESS_LEVEL
                : REPORTER_ACCESS_LEVEL,
            },
            group_access: null,
          },
        },
        200,
      );
    }

    const branchMatch = /^\/repository\/branches\/([^/]+)$/.exec(rest);
    if (method === "GET" && branchMatch !== null) {
      const name = decodeURIComponent(branchMatch[1]);
      const sha = this.git.getRef(name);
      if (sha === undefined) {
        return jsonResponse({ message: "404 Branch Not Found" }, 404);
      }
      return jsonResponse(
        {
          name,
          commit: { id: sha },
          protected: false,
          can_push: this.canWrite,
        },
        200,
      );
    }

    if (method === "GET" && rest === "/repository/tree") {
      const entries = await this.entriesAt(url.searchParams.get("ref"));
      if (entries === undefined) {
        return jsonResponse({ message: "404 Tree Not Found" }, 404);
      }
      const perPage = Math.min(
        Number(url.searchParams.get("per_page") ?? "20"),
        this.treePageSize,
      );
      const page = Number(url.searchParams.get("page") ?? "1");
      const slice = entries.slice((page - 1) * perPage, page * perPage);
      const headers: Record<string, string> = {};
      if (page * perPage < entries.length) {
        const next = new URL(url);
        next.searchParams.set("page", String(page + 1));
        headers.link = `<${next.toString()}>; rel="next"`;
      }
      return jsonResponse(
        slice.map((entry) => ({
          id: entry.sha,
          name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
          type: entry.type,
          path: entry.path,
          mode: entry.type === "tree" ? "040000" : "100644",
        })),
        200,
        headers,
      );
    }

    const blobMatch = /^\/repository\/blobs\/([^/]+)\/raw$/.exec(rest);
    if (method === "GET" && blobMatch !== null) {
      const text = this.git.getBlob(decodeURIComponent(blobMatch[1]));
      if (text === undefined) {
        return jsonResponse({ message: "404 Blob Not Found" }, 404);
      }
      return rawResponse(text);
    }

    const fileMatch = /^\/repository\/files\/([^/]+)\/raw$/.exec(rest);
    if (method === "GET" && fileMatch !== null) {
      const filePath = decodeURIComponent(fileMatch[1]);
      const entries = await this.entriesAt(
        url.searchParams.get("ref") ?? this.defaultBranch,
      );
      const entry = entries?.find(
        (candidate) => candidate.path === filePath && candidate.type === "blob",
      );
      const text =
        entry === undefined ? undefined : this.git.getBlob(entry.sha);
      if (text === undefined) {
        return jsonResponse({ message: "404 File Not Found" }, 404);
      }
      return rawResponse(text);
    }

    if (method === "POST" && rest === "/repository/commits") {
      if (!this.canWrite) {
        return jsonResponse({ message: "403 Forbidden" }, 403);
      }
      try {
        return await this.createCommit((await request.json()) as CommitBody);
      } catch (error) {
        if (error instanceof CommitRejected) {
          return jsonResponse({ message: error.message }, 400);
        }
        throw error;
      }
    }

    return jsonResponse({ message: "404 Not Found" }, 404);
  }

  private async createCommit(body: CommitBody): Promise<Response> {
    const branch = body.branch;
    if (branch === undefined) {
      throw new CommitRejected("branch is missing");
    }
    const startSha = body.start_sha;
    const startBranch =
      body.start_branch ?? (startSha === undefined ? branch : undefined);
    if (startSha !== undefined && startBranch !== undefined) {
      throw new CommitRejected(
        "You can't pass both start_branch and start_sha",
      );
    }
    const differentBranch = startBranch !== branch || startSha !== undefined;
    if (
      !this.isEmpty() &&
      differentBranch &&
      this.git.getRef(branch) !== undefined &&
      body.force !== true
    ) {
      throw new CommitRejected(
        `A branch called '${branch}' already exists. Switch to that branch in order to make changes`,
      );
    }

    let parent: string | null = null;
    if (startSha !== undefined) {
      if (this.git.getCommit(startSha) === undefined) {
        throw new CommitRejected(`Cannot find start_sha '${startSha}'`);
      }
      parent = startSha;
    } else if (!this.isEmpty()) {
      const startHead =
        startBranch === undefined ? undefined : this.git.getRef(startBranch);
      if (startHead === undefined) {
        throw new CommitRejected(
          "You can only create or edit files when you are on a branch",
        );
      }
      parent = startHead;
    }

    const baseTree =
      parent === null ? null : (this.git.getCommit(parent)?.tree ?? null);
    const files = new Set(
      baseTree === null ? [] : [...(this.git.getTree(baseTree)?.keys() ?? [])],
    );
    const changes: CommitFileChange[] = [];
    for (const action of body.actions ?? []) {
      changes.push(...this.changesFor(action, files, baseTree));
    }

    const treeSha = await this.git.applyChanges(baseTree, changes);
    const sha = await this.git.putCommit({
      tree: treeSha,
      parent,
      message: body.commit_message ?? "",
    });
    this.git.setRef(branch, sha);
    return jsonResponse(
      {
        id: sha,
        short_id: sha.slice(0, 8),
        message: body.commit_message ?? "",
        parent_ids: parent === null ? [] : [parent],
      },
      201,
    );
  }

  private changesFor(
    action: CommitActionBody,
    files: Set<string>,
    baseTree: string | null,
  ): CommitFileChange[] {
    const path = action.file_path;
    if (path === undefined) {
      throw new CommitRejected("file_path is missing");
    }
    const text = (): string => {
      if (action.content === undefined) {
        throw new CommitRejected("content is missing");
      }
      return action.encoding === "base64"
        ? utf8Decode(fromBase64(action.content))
        : action.content;
    };

    switch (action.action) {
      case "create":
        if (files.has(path)) {
          throw new CommitRejected("A file with this name already exists");
        }
        files.add(path);
        return [{ kind: "upsert-text", path, text: text() }];
      case "update":
        if (!files.has(path)) {
          throw new CommitRejected("A file with this name doesn't exist");
        }
        return [{ kind: "upsert-text", path, text: text() }];
      case "delete":
        if (!files.delete(path)) {
          throw new CommitRejected("A file with this name doesn't exist");
        }
        return [{ kind: "delete", path }];
      case "move": {
        const previous = action.previous_path;
        if (previous === undefined || !files.has(previous)) {
          throw new CommitRejected("A file with this name doesn't exist");
        }
        if (files.has(path)) {
          throw new CommitRejected("A file with this name already exists");
        }
        files.delete(previous);
        files.add(path);
        const blobSha =
          baseTree === null
            ? undefined
            : this.git.getTree(baseTree)?.get(previous);
        const moved: CommitFileChange =
          action.content !== undefined || blobSha === undefined
            ? { kind: "upsert-text", path, text: text() }
            : { kind: "upsert-blob", path, blobSha };
        return [moved, { kind: "delete", path: previous }];
      }
      default:
        throw new CommitRejected("Unknown action");
    }
  }
}
