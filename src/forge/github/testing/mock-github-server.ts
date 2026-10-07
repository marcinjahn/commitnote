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

export interface MockGitHubRepoOptions {
  owner: string;
  repo: string;
  token: string;
  canWrite?: boolean;
  defaultBranch?: string;
}

interface StoredCommitShape {
  readonly tree: string;
  readonly parent: string | null;
  readonly message: string;
}

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const EMPTY_REPO_MESSAGE = "Git Repository is empty.";
const READ_ONLY_MESSAGE = "Resource not accessible by personal access token";

function jsonResponse(
  body: JsonBodyType,
  status: number,
  headers?: Record<string, string>,
): Response {
  return HttpResponse.json(body, {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...headers },
  });
}

function wrapBase64(base64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 60) {
    lines.push(base64.slice(i, i + 60));
  }
  return `${lines.join("\n")}\n`;
}

function encodeBlobContent(text: string): string {
  return wrapBase64(toBase64(utf8Encode(text)));
}

function decodeBase64Content(content: string): string {
  return utf8Decode(fromBase64(content.replace(/\s+/g, "")));
}

// GitHub reports commit dates to the second.
function gitHubDate(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

// GitHub's contents API leaves out the content of files over 1 MB.
const CONTENTS_SIZE_LIMIT = 1024 * 1024;

function branchFromRef(ref: string | undefined): string | undefined {
  if (ref === undefined || !ref.startsWith("refs/heads/")) {
    return undefined;
  }
  return ref.slice("refs/heads/".length);
}

/**
 * Stateful, test-only mock of the GitHub REST endpoints the GitHub forge
 * adapter uses, backed by an InMemoryGitRepo. Registered as MSW handlers;
 * imported only from tests.
 */
export class MockGitHubRepo {
  readonly git = new InMemoryGitRepo();
  readonly requests: { method: string; path: string }[] = [];
  truncateTrees = false;
  commitListLinks: "full" | "withoutLast" = "full";

  private readonly owner: string;
  private readonly repoName: string;
  private readonly token: string;
  private readonly canWrite: boolean;
  private readonly defaultBranch: string;
  private readonly faults = new MockFaults(jsonResponse);
  private readonly gists = new Map<string, string>();
  private nextGist = 1;

  constructor(options: MockGitHubRepoOptions) {
    this.owner = options.owner;
    this.repoName = options.repo;
    this.token = options.token;
    this.canWrite = options.canWrite ?? true;
    this.defaultBranch = options.defaultBranch ?? "main";
  }

  failNext(match: FailureMatch, failure: MockFailure): void {
    this.faults.failNext(match, failure);
  }

  dropNextResponse(match: FailureMatch): void {
    this.faults.dropNextResponse(match);
  }

  /** The envelope stored in a gist, or null when it does not exist. */
  gistContent(gistId: string): string | null {
    return this.gists.get(gistId) ?? null;
  }

  handlers(): HttpHandler[] {
    return [
      http.all("https://api.github.com/*", ({ request }) =>
        this.handle(request),
      ),
    ];
  }

  private commitListLinkHeader(
    url: URL,
    page: number,
    lastPage: number,
  ): string | undefined {
    if (lastPage <= 1) return undefined;
    const pageUrl = (target: number): string => {
      const params = new URLSearchParams(url.searchParams);
      params.set("page", String(target));
      return `https://api.github.com${url.pathname}?${params.toString()}`;
    };
    const entries: string[] = [];
    if (page < lastPage) {
      entries.push(`<${pageUrl(page + 1)}>; rel="next"`);
      if (this.commitListLinks === "full") {
        entries.push(`<${pageUrl(lastPage)}>; rel="last"`);
      }
    }
    if (page > 1) {
      entries.push(`<${pageUrl(page - 1)}>; rel="prev"`);
      entries.push(`<${pageUrl(1)}>; rel="first"`);
    }
    return entries.join(", ");
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = `${url.pathname}${url.search}`;
    this.requests.push({ method, path });

    const injected = this.faults.takeFailure(method, path);
    if (injected !== null) return injected;

    const expectedAuth = `Bearer ${this.token}`;
    if (request.headers.get("authorization") !== expectedAuth) {
      return jsonResponse({ message: "Bad credentials" }, 401);
    }

    if (url.pathname === "/gists" || url.pathname.startsWith("/gists/")) {
      return this.routeGists(method, url.pathname, request);
    }

    const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (
      repoMatch === null ||
      repoMatch[1] !== this.owner ||
      repoMatch[2] !== this.repoName
    ) {
      return jsonResponse({ message: "Not Found" }, 404);
    }

    const response = await this.route(method, repoMatch[3] ?? "", url, request);
    if (this.faults.shouldDrop(method, path)) {
      return HttpResponse.error();
    }
    return response;
  }

  private async routeGists(
    method: string,
    pathname: string,
    request: Request,
  ): Promise<Response> {
    if (method === "POST" && pathname === "/gists") {
      const body = (await request.json()) as {
        files?: Record<string, { content?: string }>;
      };
      const content = Object.values(body.files ?? {})[0]?.content;
      if (typeof content !== "string") {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      const id = `gist${this.nextGist++}`;
      this.gists.set(id, content);
      return jsonResponse({ id }, 201);
    }
    const idMatch = /^\/gists\/([^/]+)$/.exec(pathname);
    if (method === "PATCH" && idMatch !== null) {
      if (!this.gists.has(idMatch[1])) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      const body = (await request.json()) as {
        files?: Record<string, { content?: string }>;
      };
      const content = body.files?.["commitnote-share.json"]?.content;
      if (typeof content !== "string") {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      this.gists.set(idMatch[1], content);
      return jsonResponse({ id: idMatch[1] }, 200);
    }
    if (method === "DELETE" && idMatch !== null) {
      return this.gists.delete(idMatch[1])
        ? new HttpResponse(null, { status: 204 })
        : jsonResponse({ message: "Not Found" }, 404);
    }
    return jsonResponse({ message: "Not Found" }, 404);
  }

  private isEmpty(): boolean {
    return !this.git.hasCommits();
  }

  private refShape(branch: string, sha: string): Record<string, unknown> {
    return { ref: `refs/heads/${branch}`, object: { sha, type: "commit" } };
  }

  private commitShape(
    sha: string,
    commit: StoredCommitShape,
  ): Record<string, unknown> {
    return {
      sha,
      tree: { sha: commit.tree },
      parents: commit.parent === null ? [] : [{ sha: commit.parent }],
      message: commit.message,
    };
  }

  private treeEntryShape(entry: TreeEntry): Record<string, unknown> {
    const shape: Record<string, unknown> = {
      path: entry.path,
      mode: entry.type === "tree" ? "040000" : "100644",
      type: entry.type,
      sha: entry.sha,
    };
    if (entry.type === "blob") {
      const text = this.git.getBlob(entry.sha);
      if (text !== undefined) {
        shape.size = utf8Encode(text).length;
      }
    }
    return shape;
  }

  private resolveRef(ref: string | undefined): string | undefined {
    const target = ref ?? this.defaultBranch;
    const branchSha = this.git.getRef(target);
    if (branchSha !== undefined) {
      return branchSha;
    }
    return this.git.getCommit(target) !== undefined ? target : undefined;
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
          name: this.repoName,
          full_name: `${this.owner}/${this.repoName}`,
          private: true,
          default_branch: this.defaultBranch,
          permissions: {
            admin: false,
            maintain: false,
            push: this.canWrite,
            triage: this.canWrite,
            pull: true,
          },
        },
        200,
      );
    }

    const refMatch = /^\/git\/ref\/heads\/([^/]+)$/.exec(rest);
    if (method === "GET" && refMatch !== null) {
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const branch = decodeURIComponent(refMatch[1]);
      const sha = this.git.getRef(branch);
      if (sha === undefined) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse(this.refShape(branch, sha), 200);
    }

    if (method === "POST" && rest === "/git/refs") {
      if (!this.canWrite) {
        return jsonResponse({ message: READ_ONLY_MESSAGE }, 403);
      }
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const body = (await request.json()) as { ref?: string; sha?: string };
      const branch = branchFromRef(body.ref);
      if (branch === undefined) {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      if (this.git.getRef(branch) !== undefined) {
        return jsonResponse({ message: "Reference already exists" }, 422);
      }
      if (
        body.sha === undefined ||
        this.git.getCommit(body.sha) === undefined
      ) {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      this.git.setRef(branch, body.sha);
      return jsonResponse(this.refShape(branch, body.sha), 201);
    }

    const updateRefMatch = /^\/git\/refs\/heads\/([^/]+)$/.exec(rest);
    if (method === "PATCH" && updateRefMatch !== null) {
      if (!this.canWrite) {
        return jsonResponse({ message: READ_ONLY_MESSAGE }, 403);
      }
      const branch = decodeURIComponent(updateRefMatch[1]);
      const current = this.git.getRef(branch);
      if (current === undefined) {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      const body = (await request.json()) as {
        sha?: string;
        force?: boolean;
      };
      if (body.sha === undefined) {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      if (body.force !== true && !this.git.isAncestor(current, body.sha)) {
        return jsonResponse({ message: "Update is not a fast forward" }, 422);
      }
      this.git.setRef(branch, body.sha);
      return jsonResponse(this.refShape(branch, body.sha), 200);
    }

    const commitMatch = /^\/git\/commits\/([^/]+)$/.exec(rest);
    if (method === "GET" && commitMatch !== null) {
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const sha = commitMatch[1];
      const commit = this.git.getCommit(sha);
      if (commit === undefined) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse(this.commitShape(sha, commit), 200);
    }

    if (method === "POST" && rest === "/git/commits") {
      if (!this.canWrite) {
        return jsonResponse({ message: READ_ONLY_MESSAGE }, 403);
      }
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const body = (await request.json()) as {
        message?: string;
        tree?: string;
        parents?: string[];
      };
      if (
        body.tree === undefined ||
        this.git.getTree(body.tree) === undefined
      ) {
        return jsonResponse({ message: "Validation Failed" }, 422);
      }
      const parents = body.parents ?? [];
      for (const parentSha of parents) {
        if (this.git.getCommit(parentSha) === undefined) {
          return jsonResponse({ message: "Validation Failed" }, 422);
        }
      }
      const parent = parents[0] ?? null;
      const message = body.message ?? "";
      const sha = await this.git.putCommit({
        tree: body.tree,
        parent,
        message,
      });
      return jsonResponse(
        this.commitShape(sha, { tree: body.tree, parent, message }),
        201,
      );
    }

    const treeMatch = /^\/git\/trees\/([^/]+)$/.exec(rest);
    if (method === "GET" && treeMatch !== null) {
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const sha =
        this.git.getCommit(treeMatch[1])?.tree ?? treeMatch[1];
      if (this.git.getTree(sha) === undefined) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      const recursive = url.searchParams.has("recursive");
      const entries = (await this.git.listTreeEntries(sha)).filter(
        (entry) => recursive || !entry.path.includes("/"),
      );
      return jsonResponse(
        {
          sha,
          tree: entries.map((entry) => this.treeEntryShape(entry)),
          truncated: this.truncateTrees,
        },
        200,
      );
    }

    if (method === "POST" && rest === "/git/trees") {
      if (!this.canWrite) {
        return jsonResponse({ message: READ_ONLY_MESSAGE }, 403);
      }
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const body = (await request.json()) as {
        base_tree?: string;
        tree: Array<{
          path: string;
          mode: string;
          type: "blob";
          sha?: string | null;
          content?: string;
        }>;
      };
      let baseTree: string | null = null;
      if (body.base_tree !== undefined) {
        if (this.git.getTree(body.base_tree) === undefined) {
          return jsonResponse({ message: "Validation Failed" }, 422);
        }
        baseTree = body.base_tree;
      }
      const changes: CommitFileChange[] = [];
      for (const item of body.tree) {
        if (item.sha !== undefined && item.content !== undefined) {
          return jsonResponse({ message: "Validation Failed" }, 422);
        }
        if (item.sha === null) {
          changes.push({ kind: "delete", path: item.path });
        } else if (typeof item.sha === "string") {
          if (this.git.getBlob(item.sha) === undefined) {
            return jsonResponse({ message: "Validation Failed" }, 422);
          }
          changes.push({
            kind: "upsert-blob",
            path: item.path,
            blobSha: item.sha,
          });
        } else if (item.content !== undefined) {
          changes.push({
            kind: "upsert-text",
            path: item.path,
            text: item.content,
          });
        } else {
          return jsonResponse({ message: "Validation Failed" }, 422);
        }
      }
      const newTreeSha = await this.git.applyChanges(baseTree, changes);
      const entries = await this.git.listTreeEntries(newTreeSha);
      return jsonResponse(
        {
          sha: newTreeSha,
          tree: entries.map((entry) => this.treeEntryShape(entry)),
          truncated: false,
        },
        201,
      );
    }

    const blobMatch = /^\/git\/blobs\/([^/]+)$/.exec(rest);
    if (method === "GET" && blobMatch !== null) {
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const sha = blobMatch[1];
      const text = this.git.getBlob(sha);
      if (text === undefined) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse(
        {
          sha,
          size: utf8Encode(text).length,
          encoding: "base64",
          content: encodeBlobContent(text),
        },
        200,
      );
    }

    if (method === "GET" && rest === "/commits") {
      if (this.isEmpty()) {
        return jsonResponse({ message: EMPTY_REPO_MESSAGE }, 409);
      }
      const sha = url.searchParams.get("sha") ?? undefined;
      const from = this.resolveRef(sha);
      if (from === undefined) {
        return jsonResponse(
          { message: `No commit found for SHA: ${sha ?? ""}` },
          404,
        );
      }
      const path = url.searchParams.get("path");
      const commits =
        path === null ? [] : (this.git.commitsTouching(from, path) ?? []);
      const perPage = Math.min(
        Number(url.searchParams.get("per_page") ?? "30"),
        100,
      );
      const page = Number(url.searchParams.get("page") ?? "1");
      const link = this.commitListLinkHeader(
        url,
        page,
        Math.ceil(commits.length / perPage),
      );
      return jsonResponse(
        commits
          .slice((page - 1) * perPage, page * perPage)
          .map(([commitSha, commit]) => ({
            sha: commitSha,
            commit: {
              message: commit.message,
              committer: { date: gitHubDate(commit.committedAt) },
              tree: { sha: commit.tree },
            },
            parents: commit.parent === null ? [] : [{ sha: commit.parent }],
          })),
        200,
        link === undefined ? undefined : { link },
      );
    }

    if (method === "GET" && rest.startsWith("/contents/")) {
      const path = decodeURIComponent(rest.slice("/contents/".length));
      const ref = url.searchParams.get("ref") ?? undefined;
      const commitSha = this.resolveRef(ref);
      const commit =
        commitSha === undefined ? undefined : this.git.getCommit(commitSha);
      if (commit === undefined) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      const entries = await this.git.listTreeEntries(commit.tree);
      if (entries.some((e) => e.path === path && e.type === "tree")) {
        return jsonResponse(
          entries
            .filter((e) => e.path.startsWith(`${path}/`))
            .filter((e) => !e.path.slice(path.length + 1).includes("/"))
            .map((e) => ({
              type: e.type === "tree" ? "dir" : "file",
              sha: e.sha,
              path: e.path,
            })),
          200,
        );
      }
      const entry = entries.find(
        (candidate) => candidate.path === path && candidate.type === "blob",
      );
      const text =
        entry === undefined ? undefined : this.git.getBlob(entry.sha);
      if (entry === undefined || text === undefined) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      const size = utf8Encode(text).length;
      const tooLarge = size > CONTENTS_SIZE_LIMIT;
      return jsonResponse(
        {
          type: "file",
          encoding: tooLarge ? "none" : "base64",
          content: tooLarge ? "" : encodeBlobContent(text),
          size,
          sha: entry.sha,
          path,
        },
        200,
      );
    }

    if (method === "PUT" && rest.startsWith("/contents/")) {
      if (!this.canWrite) {
        return jsonResponse({ message: READ_ONLY_MESSAGE }, 403);
      }
      const path = decodeURIComponent(rest.slice("/contents/".length));
      const body = (await request.json()) as {
        message?: string;
        content: string;
        branch?: string;
        sha?: string;
      };
      const text = decodeBase64Content(body.content);
      const branch = body.branch ?? this.defaultBranch;
      const message = body.message ?? "";

      if (this.isEmpty()) {
        const blobSha = await this.git.putBlob(text);
        const treeSha = await this.git.applyChanges(null, [
          { kind: "upsert-blob", path, blobSha },
        ]);
        const commitSha = await this.git.putCommit({
          tree: treeSha,
          parent: null,
          message,
        });
        this.git.setRef(branch, commitSha);
        return jsonResponse(
          {
            content: { path, sha: blobSha },
            commit: { sha: commitSha, parents: [] },
          },
          201,
        );
      }

      const parentSha = this.git.getRef(branch);
      const parentCommit =
        parentSha === undefined ? undefined : this.git.getCommit(parentSha);
      const baseTree = parentCommit?.tree ?? null;

      if (baseTree !== null) {
        const entries = await this.git.listTreeEntries(baseTree);
        const exists = entries.some(
          (entry) => entry.path === path && entry.type === "blob",
        );
        if (exists && body.sha === undefined) {
          return jsonResponse(
            { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' },
            422,
          );
        }
      }

      const blobSha = await this.git.putBlob(text);
      const newTreeSha = await this.git.applyChanges(baseTree, [
        { kind: "upsert-blob", path, blobSha },
      ]);
      const commitSha = await this.git.putCommit({
        tree: newTreeSha,
        parent: parentSha ?? null,
        message,
      });
      this.git.setRef(branch, commitSha);
      return jsonResponse(
        {
          content: { path, sha: blobSha },
          commit: {
            sha: commitSha,
            parents: parentSha === undefined ? [] : [{ sha: parentSha }],
          },
        },
        201,
      );
    }

    return jsonResponse({ message: "Not Found" }, 404);
  }
}
