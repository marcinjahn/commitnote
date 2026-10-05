import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import {
  fromBase64,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../../../crypto/base64";
import type { CommitFileChange, TreeEntry } from "../../forge-adapter";
import { InMemoryGitRepo } from "../../fake/in-memory-git-repo";
import { MockFaults } from "../../fake/mock-faults";
import type { FailureMatch, MockFailure } from "../../fake/mock-faults";

export type { MockFailure };

export interface MockGitLabRepoOptions {
  /** Full project path, e.g. "group/sub/notes". */
  projectPath: string;
  token: string;
  canWrite?: boolean;
  /** Maintainers may change project settings. */
  maintainer?: boolean;
  defaultBranch?: string;
  mergeMethod?: "merge" | "rebase_merge" | "ff";
  now?: () => number;
}

export interface MockMergeRequest {
  readonly iid: number;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly title: string;
  readonly createdAt: string;
  readonly removeSourceBranch: boolean;
  state: "opened" | "closed" | "merged" | "locked";
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
const MAINTAINER_ACCESS_LEVEL = 40;
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
  readonly mergeRequests = new Map<number, MockMergeRequest>();
  treePageSize = 100;
  omitTotals = false;
  mergeMethod: "merge" | "rebase_merge" | "ff";
  squashOption = "default_off";
  onlyAllowMergeIfPipelineSucceeds = false;
  approvalsBeforeMerge = 0;
  /** Merge-status reads that answer "checking" for each new merge request. */
  mergeCheckingRounds = 0;
  /**
   * Merge-request reads that answer "locked" after an accepted merge, which
   * only reaches the target branch after them.
   */
  mergeLockedReads = 0;
  /** Runs once, just before the next commit to main is applied. */
  beforeCommitToMain: (() => Promise<void>) | null = null;

  private readonly projectPath: string;
  private readonly token: string;
  private readonly canWrite: boolean;
  private readonly maintainer: boolean;
  private readonly defaultBranch: string;
  private readonly now: () => number;
  private readonly faults = new MockFaults(jsonResponse);
  private readonly commitDates = new Map<string, string>();
  private readonly pendingChecks = new Map<number, number>();
  private readonly lockedMerges = new Map<
    number,
    { reads: number; source: string; removeSource: boolean }
  >();
  private nextIid = 1;
  private readonly snippets = new Map<number, string>();
  private nextSnippetId = 1;

  constructor(options: MockGitLabRepoOptions) {
    this.projectPath = options.projectPath;
    this.token = options.token;
    this.canWrite = options.canWrite ?? true;
    this.maintainer = options.maintainer ?? false;
    this.defaultBranch = options.defaultBranch ?? "main";
    this.mergeMethod = options.mergeMethod ?? "merge";
    this.now = options.now ?? Date.now;
  }

  failNext(match: FailureMatch, failure: MockFailure): void {
    this.faults.failNext(match, failure);
  }

  dropNextResponse(match: FailureMatch): void {
    this.faults.dropNextResponse(match);
  }

  /** Dates a commit for the sweep's age check. */
  setCommitDate(sha: string, date: Date): void {
    this.commitDates.set(sha, date.toISOString());
  }

  /** The envelope stored in a snippet, or null when it does not exist. */
  snippetContent(snippetId: string): string | null {
    return this.snippets.get(Number(snippetId)) ?? null;
  }

  handlers(): HttpHandler[] {
    return [
      http.all("https://gitlab.com/api/v4/snippets*", ({ request }) =>
        this.handleSnippets(request),
      ),
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

    const injected = this.faults.takeFailure(method, path);
    if (injected !== null) return injected;

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

    const response = await this.route(
      method,
      projectMatch[2] ?? "",
      url,
      request,
    );
    if (this.faults.shouldDrop(method, path)) {
      return HttpResponse.error();
    }
    return response;
  }

  private async handleSnippets(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = `${url.pathname}${url.search}`;
    this.requests.push({ method, path });

    const injected = this.faults.takeFailure(method, path);
    if (injected !== null) return injected;

    if (request.headers.get("authorization") !== `Bearer ${this.token}`) {
      return jsonResponse({ message: "401 Unauthorized" }, 401);
    }

    if (method === "POST" && url.pathname === `${API_PREFIX}/snippets`) {
      const body = (await request.json()) as {
        files?: readonly { content?: string }[];
      };
      const content = body.files?.[0]?.content;
      if (typeof content !== "string") {
        return jsonResponse({ message: "400 Bad request" }, 400);
      }
      const id = this.nextSnippetId++;
      this.snippets.set(id, content);
      return jsonResponse({ id }, 201);
    }
    const idMatch = new RegExp(`^${API_PREFIX}/snippets/(\\d+)$`).exec(
      url.pathname,
    );
    if (method === "DELETE" && idMatch !== null) {
      return this.snippets.delete(Number(idMatch[1]))
        ? new HttpResponse(null, { status: 204 })
        : jsonResponse({ message: "404 Snippet Not Found" }, 404);
    }
    return jsonResponse({ message: "404 Not Found" }, 404);
  }

  private accessLevel(): number {
    if (!this.canWrite) return REPORTER_ACCESS_LEVEL;
    return this.maintainer ? MAINTAINER_ACCESS_LEVEL : DEVELOPER_ACCESS_LEVEL;
  }

  private projectBody(): JsonBodyType {
    return {
      id: 1,
      path_with_namespace: this.projectPath,
      default_branch: this.isEmpty() ? null : this.defaultBranch,
      empty_repo: this.isEmpty(),
      merge_method: this.mergeMethod,
      squash_option: this.squashOption,
      only_allow_merge_if_pipeline_succeeds:
        this.onlyAllowMergeIfPipelineSucceeds,
      approvals_before_merge: this.approvalsBeforeMerge,
      permissions: {
        project_access: { access_level: this.accessLevel() },
        group_access: null,
      },
    };
  }

  private branchBody(name: string, sha: string): JsonBodyType {
    const commit = this.git.getCommit(sha);
    return {
      name,
      commit: {
        id: sha,
        parent_ids:
          commit?.parent === null || commit === undefined ? [] : [commit.parent],
        committed_date:
          this.commitDates.get(sha) ?? new Date(this.now()).toISOString(),
      },
      protected: false,
      can_push: this.canWrite,
    };
  }

  private detailedMergeStatus(mergeRequest: MockMergeRequest): string {
    if (mergeRequest.state === "locked") return "locked";
    if (mergeRequest.state !== "opened") return "not_open";
    const pending = this.pendingChecks.get(mergeRequest.iid) ?? 0;
    if (pending > 0) return "checking";
    if (this.approvalsBeforeMerge > 0) return "not_approved";
    const source = this.git.getRef(mergeRequest.sourceBranch);
    const target = this.git.getRef(mergeRequest.targetBranch);
    if (source === undefined) return "commits_status";
    if (target === undefined || !this.git.isAncestor(target, source)) {
      return "need_rebase";
    }
    return "mergeable";
  }

  private mergeRequestBody(mergeRequest: MockMergeRequest): JsonBodyType {
    return {
      id: 1000 + mergeRequest.iid,
      iid: mergeRequest.iid,
      title: mergeRequest.title,
      state: mergeRequest.state,
      source_branch: mergeRequest.sourceBranch,
      target_branch: mergeRequest.targetBranch,
      created_at: mergeRequest.createdAt,
      detailed_merge_status: this.detailedMergeStatus(mergeRequest),
      merge_commit_sha: null,
      squash_commit_sha: null,
    };
  }

  private async routeMergeRequests(
    method: string,
    rest: string,
    url: URL,
    request: Request,
  ): Promise<Response | undefined> {
    if (method === "POST" && rest === "/merge_requests") {
      if (!this.canWrite) {
        return jsonResponse({ message: "403 Forbidden" }, 403);
      }
      const body = (await request.json()) as {
        source_branch?: string;
        target_branch?: string;
        title?: string;
        remove_source_branch?: boolean;
      };
      const source = body.source_branch ?? "";
      const target = body.target_branch ?? "";
      if (
        this.git.getRef(source) === undefined ||
        this.git.getRef(target) === undefined
      ) {
        return jsonResponse({ message: "Branch does not exist" }, 422);
      }
      const duplicate = [...this.mergeRequests.values()].some(
        (existing) =>
          existing.state === "opened" &&
          existing.sourceBranch === source &&
          existing.targetBranch === target,
      );
      if (duplicate) {
        return jsonResponse(
          { message: ["Another open merge request already exists"] },
          409,
        );
      }
      const mergeRequest: MockMergeRequest = {
        iid: this.nextIid++,
        sourceBranch: source,
        targetBranch: target,
        title: body.title ?? "",
        createdAt: new Date(this.now()).toISOString(),
        removeSourceBranch: body.remove_source_branch === true,
        state: "opened",
      };
      this.mergeRequests.set(mergeRequest.iid, mergeRequest);
      this.pendingChecks.set(mergeRequest.iid, this.mergeCheckingRounds);
      return jsonResponse(this.mergeRequestBody(mergeRequest), 201);
    }

    if (method === "GET" && rest === "/merge_requests") {
      const state = url.searchParams.get("state");
      const source = url.searchParams.get("source_branch");
      const target = url.searchParams.get("target_branch");
      const matching = [...this.mergeRequests.values()].filter(
        (mergeRequest) =>
          (state === null || mergeRequest.state === state) &&
          (source === null || mergeRequest.sourceBranch === source) &&
          (target === null || mergeRequest.targetBranch === target),
      );
      return jsonResponse(
        matching.map((mergeRequest) => this.mergeRequestBody(mergeRequest)),
        200,
      );
    }

    const singleMatch = /^\/merge_requests\/(\d+)(\/merge)?$/.exec(rest);
    if (singleMatch === null) return undefined;
    const mergeRequest = this.mergeRequests.get(Number(singleMatch[1]));
    if (mergeRequest === undefined) {
      return jsonResponse({ message: "404 Not found" }, 404);
    }
    const isMerge = singleMatch[2] !== undefined;

    if (method === "GET" && !isMerge) {
      const locked = this.lockedMerges.get(mergeRequest.iid);
      if (locked !== undefined) {
        locked.reads--;
        if (locked.reads <= 0) {
          this.lockedMerges.delete(mergeRequest.iid);
          this.completeMerge(mergeRequest, locked.source, locked.removeSource);
        }
      }
      const body = this.mergeRequestBody(mergeRequest);
      const pending = this.pendingChecks.get(mergeRequest.iid) ?? 0;
      if (pending > 0) this.pendingChecks.set(mergeRequest.iid, pending - 1);
      return jsonResponse(body, 200);
    }

    if (method === "PUT" && !isMerge) {
      if (!this.canWrite) {
        return jsonResponse({ message: "403 Forbidden" }, 403);
      }
      const body = (await request.json()) as { state_event?: string };
      if (mergeRequest.state === "locked") {
        return jsonResponse({ message: "405 Method Not Allowed" }, 405);
      }
      if (body.state_event === "close" && mergeRequest.state === "opened") {
        mergeRequest.state = "closed";
      }
      return jsonResponse(this.mergeRequestBody(mergeRequest), 200);
    }

    if (method === "PUT" && isMerge) {
      if (!this.canWrite) {
        return jsonResponse({ message: "401 Unauthorized" }, 401);
      }
      const body = (await request.json()) as {
        sha?: string;
        should_remove_source_branch?: boolean;
      };
      const status = this.detailedMergeStatus(mergeRequest);
      if (status === "not_open" || status === "checking") {
        return jsonResponse({ message: "405 Method Not Allowed" }, 405);
      }
      const source = this.git.getRef(mergeRequest.sourceBranch);
      if (body.sha !== undefined && body.sha !== source) {
        return jsonResponse(
          { message: "SHA does not match HEAD of source branch" },
          409,
        );
      }
      if (status !== "mergeable" || source === undefined) {
        return jsonResponse({ message: "405 Method Not Allowed" }, 405);
      }
      if (this.mergeMethod !== "ff") {
        return jsonResponse(
          { message: "The mock only fast-forwards" },
          422,
        );
      }
      const removeSource =
        body.should_remove_source_branch === true ||
        mergeRequest.removeSourceBranch;
      if (this.mergeLockedReads > 0) {
        mergeRequest.state = "locked";
        this.lockedMerges.set(mergeRequest.iid, {
          reads: this.mergeLockedReads,
          source,
          removeSource,
        });
        return jsonResponse(this.mergeRequestBody(mergeRequest), 200);
      }
      this.completeMerge(mergeRequest, source, removeSource);
      return jsonResponse(this.mergeRequestBody(mergeRequest), 200);
    }
    return undefined;
  }

  private completeMerge(
    mergeRequest: MockMergeRequest,
    source: string,
    removeSource: boolean,
  ): void {
    this.git.setRef(mergeRequest.targetBranch, source);
    mergeRequest.state = "merged";
    if (removeSource) this.git.deleteRef(mergeRequest.sourceBranch);
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
      return jsonResponse(this.projectBody(), 200);
    }

    if (method === "PUT" && rest === "") {
      if (!this.maintainer) {
        return jsonResponse({ message: "403 Forbidden" }, 403);
      }
      const body = (await request.json()) as {
        merge_method?: "merge" | "rebase_merge" | "ff";
        squash_option?: string;
        only_allow_merge_if_pipeline_succeeds?: boolean;
      };
      this.mergeMethod = body.merge_method ?? this.mergeMethod;
      this.squashOption = body.squash_option ?? this.squashOption;
      this.onlyAllowMergeIfPipelineSucceeds =
        body.only_allow_merge_if_pipeline_succeeds ??
        this.onlyAllowMergeIfPipelineSucceeds;
      return jsonResponse(this.projectBody(), 200);
    }

    const mergeRequestResponse = await this.routeMergeRequests(
      method,
      rest,
      url,
      request,
    );
    if (mergeRequestResponse !== undefined) {
      return mergeRequestResponse;
    }

    if (method === "GET" && rest === "/repository/branches") {
      const search = url.searchParams.get("search") ?? "";
      const names = this.git
        .branchNames()
        .filter((name) =>
          search.startsWith("^")
            ? name.startsWith(search.slice(1))
            : name.includes(search),
        );
      return jsonResponse(
        names.map((name) => this.branchBody(name, this.git.getRef(name) ?? "")),
        200,
      );
    }

    if (method === "GET" && rest === "/repository/merge_base") {
      const [first, second] = url.searchParams
        .getAll("refs[]")
        .map((ref) => this.resolveCommit(ref));
      if (first === undefined || second === undefined) {
        return jsonResponse({ message: "404 Not Found" }, 404);
      }
      let base: string | null = second;
      while (base !== null && !this.git.isAncestor(base, first)) {
        base = this.git.getCommit(base)?.parent ?? null;
      }
      if (base === null) {
        return jsonResponse({ message: "400 Bad Request" }, 400);
      }
      return jsonResponse({ id: base }, 200);
    }

    const branchMatch = /^\/repository\/branches\/([^/]+)$/.exec(rest);
    if (method === "GET" && branchMatch !== null) {
      const name = decodeURIComponent(branchMatch[1]);
      const sha = this.git.getRef(name);
      if (sha === undefined) {
        return jsonResponse({ message: "404 Branch Not Found" }, 404);
      }
      return jsonResponse(this.branchBody(name, sha), 200);
    }

    if (method === "DELETE" && branchMatch !== null) {
      if (!this.canWrite) {
        return jsonResponse({ message: "403 Forbidden" }, 403);
      }
      const name = decodeURIComponent(branchMatch[1]);
      if (this.git.getRef(name) === undefined) {
        return jsonResponse({ message: "404 Branch Not Found" }, 404);
      }
      this.git.deleteRef(name);
      return new HttpResponse(null, { status: 204 });
    }

    if (method === "GET" && rest === "/repository/tree") {
      const allEntries = await this.entriesAt(url.searchParams.get("ref"));
      if (allEntries === undefined) {
        return jsonResponse({ message: "404 Tree Not Found" }, 404);
      }
      const recursive = url.searchParams.get("recursive") === "true";
      const entries = allEntries.filter(
        (entry) => recursive || !entry.path.includes("/"),
      );
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

    if (method === "GET" && rest === "/repository/commits") {
      const from = this.resolveCommit(url.searchParams.get("ref_name"));
      const path = url.searchParams.get("path");
      const commits =
        from === undefined || path === null
          ? []
          : (this.git.commitsTouching(from, path) ?? []);
      const perPage = Math.min(
        Number(url.searchParams.get("per_page") ?? "20"),
        100,
      );
      const page = Number(url.searchParams.get("page") ?? "1");
      const totalPages = Math.ceil(commits.length / perPage);
      const headers: Record<string, string> = {
        "x-page": String(page),
        "x-per-page": String(perPage),
        "x-next-page": page < totalPages ? String(page + 1) : "",
        "x-prev-page": page > 1 ? String(page - 1) : "",
      };
      if (!this.omitTotals) {
        headers["x-total"] = String(commits.length);
        headers["x-total-pages"] = String(totalPages);
      }
      return jsonResponse(
        commits
          .slice((page - 1) * perPage, page * perPage)
          .map(([sha, commit]) => ({
            id: sha,
            parent_ids: commit.parent === null ? [] : [commit.parent],
            message: commit.message,
            committed_date:
              this.commitDates.get(sha) ??
              new Date(commit.committedAt).toISOString(),
          })),
        200,
        headers,
      );
    }

    const commitMatch = /^\/repository\/commits\/([^/]+)$/.exec(rest);
    if (method === "GET" && commitMatch !== null) {
      const sha = this.resolveCommit(decodeURIComponent(commitMatch[1]));
      const commit = sha === undefined ? undefined : this.git.getCommit(sha);
      if (sha === undefined || commit === undefined) {
        return jsonResponse({ message: "404 Commit Not Found" }, 404);
      }
      return jsonResponse(
        {
          id: sha,
          parent_ids: commit.parent === null ? [] : [commit.parent],
          message: commit.message,
          committed_date:
            this.commitDates.get(sha) ??
            new Date(commit.committedAt).toISOString(),
        },
        200,
      );
    }

    const fileInfoMatch = /^\/repository\/files\/([^/]+)$/.exec(rest);
    if (method === "GET" && fileInfoMatch !== null) {
      const filePath = decodeURIComponent(fileInfoMatch[1]);
      const ref = url.searchParams.get("ref");
      const sha = this.resolveCommit(ref);
      const blobSha =
        sha === undefined ? undefined : this.git.fileAt(sha, filePath);
      const text =
        blobSha === undefined ? undefined : this.git.getBlob(blobSha);
      if (blobSha === undefined || text === undefined) {
        return jsonResponse({ message: "404 File Not Found" }, 404);
      }
      return jsonResponse(
        {
          file_name: filePath.slice(filePath.lastIndexOf("/") + 1),
          file_path: filePath,
          size: utf8Encode(text).length,
          encoding: "base64",
          content: toBase64(utf8Encode(text)),
          ref,
          blob_id: blobSha,
          commit_id: sha,
        },
        200,
      );
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
      const body = (await request.json()) as CommitBody;
      const hook = this.beforeCommitToMain;
      if (hook !== null && body.branch === "main") {
        this.beforeCommitToMain = null;
        await hook();
      }
      try {
        return await this.createCommit(body);
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
    this.commitDates.set(sha, new Date(this.now()).toISOString());
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
