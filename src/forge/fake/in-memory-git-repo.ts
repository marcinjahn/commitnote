import { MAIN_BRANCH } from "../../format/v1";
import { ForgeError } from "../errors";
import { byPath } from "../forge-http";
import { fromBase64, toBase64, utf8Encode } from "../../crypto/base64";
import { gitBlobSha, gitBlobShaOfBytes } from "../git-blob-sha";
import type { CommitFileChange, TreeEntry } from "../forge-adapter";

/** Every object of a repo, in a JSON-serializable form. */
export interface GitObjectsSnapshot {
  readonly blobs: readonly (readonly [string, string])[];
  /** `[sha, base64]` of blobs stored as bytes. */
  readonly binaryBlobs?: readonly (readonly [string, string])[];
  readonly trees: readonly (readonly [string, readonly (readonly [string, string])[]])[];
  readonly commits: readonly (readonly [string, SnapshotCommit])[];
}

export interface StoredCommit {
  readonly tree: string;
  readonly parent: string | null;
  readonly message: string;
  /** Ms since epoch. */
  readonly committedAt: number;
}

type SnapshotCommit = Omit<StoredCommit, "committedAt"> & {
  readonly committedAt?: number;
};

function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return toHex(digest);
}

function canonicalTree(files: ReadonlyMap<string, string>): string {
  const lines = [...files.keys()]
    .sort()
    .map((path) => `${path}\0${files.get(path)}\n`)
    .join("");
  return `tree\n${lines}`;
}

/**
 * Pure in-memory git object store: blobs, flat-map trees, commits and
 * branch refs. Also backs the mock GitHub and GitLab servers.
 */
export class InMemoryGitRepo {
  private readonly blobs = new Map<string, string | Uint8Array>();
  private readonly trees = new Map<string, ReadonlyMap<string, string>>();
  private readonly commits = new Map<string, StoredCommit>();
  private readonly refs = new Map<string, string>();
  private commitSeq = 0;
  private readonly now: () => number;

  constructor(options?: { readonly now?: () => number }) {
    this.now = options?.now ?? Date.now;
  }

  async putBlob(text: string): Promise<string> {
    const sha = await gitBlobSha(text);
    this.blobs.set(sha, text);
    return sha;
  }

  async putBlobBytes(bytes: Uint8Array): Promise<string> {
    const sha = await gitBlobShaOfBytes(bytes);
    if (!this.blobs.has(sha)) this.blobs.set(sha, bytes.slice());
    return sha;
  }

  getBlob(sha: string): string | undefined {
    const blob = this.blobs.get(sha);
    return blob instanceof Uint8Array
      ? new TextDecoder().decode(blob)
      : blob;
  }

  isBytesBlob(sha: string): boolean {
    return this.blobs.get(sha) instanceof Uint8Array;
  }

  getBlobBytes(sha: string): Uint8Array | undefined {
    const blob = this.blobs.get(sha);
    if (blob === undefined) return undefined;
    return typeof blob === "string" ? utf8Encode(blob) : blob.slice();
  }

  async putTree(files: ReadonlyMap<string, string>): Promise<string> {
    const sha = await sha1Hex(canonicalTree(files));
    this.trees.set(sha, new Map(files));
    return sha;
  }

  getTree(sha: string): ReadonlyMap<string, string> | undefined {
    return this.trees.get(sha);
  }

  async putCommit(input: {
    tree: string;
    parent: string | null;
    message: string;
    committedAt?: number;
  }): Promise<string> {
    const seq = this.commitSeq++;
    const content = `commit\ntree ${input.tree}\nparent ${input.parent ?? ""}\nseq ${seq}\n\n${input.message}\n`;
    const sha = await sha1Hex(content);
    this.commits.set(sha, {
      tree: input.tree,
      parent: input.parent,
      message: input.message,
      committedAt: input.committedAt ?? this.now(),
    });
    return sha;
  }

  getCommit(sha: string): StoredCommit | undefined {
    return this.commits.get(sha);
  }

  getRef(branch: string): string | undefined {
    return this.refs.get(branch);
  }

  setRef(branch: string, sha: string): void {
    this.refs.set(branch, sha);
  }

  deleteRef(branch: string): void {
    this.refs.delete(branch);
  }

  branchNames(): string[] {
    return [...this.refs.keys()];
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    for (
      let sha: string | null = descendant;
      sha !== null;
      sha = this.commits.get(sha)?.parent ?? null
    ) {
      if (sha === ancestor) return true;
    }
    return false;
  }

  exportObjects(): GitObjectsSnapshot {
    const blobs: (readonly [string, string])[] = [];
    const binaryBlobs: (readonly [string, string])[] = [];
    for (const [sha, blob] of this.blobs) {
      if (typeof blob === "string") blobs.push([sha, blob]);
      else binaryBlobs.push([sha, toBase64(blob)]);
    }
    return {
      blobs,
      ...(binaryBlobs.length > 0 ? { binaryBlobs } : {}),
      trees: [...this.trees].map(([sha, files]) => [sha, [...files]] as const),
      commits: [...this.commits],
    };
  }

  /** Adds objects of another repo, as a fetch would; refs stay as they are. */
  importObjects(snapshot: GitObjectsSnapshot): void {
    for (const [sha, text] of snapshot.blobs) this.blobs.set(sha, text);
    for (const [sha, base64] of snapshot.binaryBlobs ?? []) {
      this.blobs.set(sha, fromBase64(base64));
    }
    for (const [sha, files] of snapshot.trees) this.trees.set(sha, new Map(files));
    for (const [sha, commit] of snapshot.commits) {
      this.commits.set(sha, { ...commit, committedAt: commit.committedAt ?? 0 });
    }
  }

  hasCommits(): boolean {
    return this.commits.size > 0;
  }

  /** Blob SHA of the file at `path` in a commit, if both exist. */
  fileAt(commitSha: string, path: string): string | undefined {
    const commit = this.commits.get(commitSha);
    return commit === undefined
      ? undefined
      : this.trees.get(commit.tree)?.get(path);
  }

  /**
   * Newest first: commits from `from` (inclusive) whose blob at `path`
   * differs from their parent's. Undefined when `from` is unknown.
   */
  commitsTouching(
    from: string,
    path: string,
  ): (readonly [string, StoredCommit])[] | undefined {
    if (!this.commits.has(from)) return undefined;
    const touching: (readonly [string, StoredCommit])[] = [];
    for (
      let sha: string | null = from;
      sha !== null;
      sha = this.commits.get(sha)?.parent ?? null
    ) {
      const commit = this.commits.get(sha);
      if (commit === undefined) break;
      const before =
        commit.parent === null ? undefined : this.fileAt(commit.parent, path);
      if (this.fileAt(sha, path) !== before) touching.push([sha, commit]);
    }
    return touching;
  }

  async listTreeEntries(treeSha: string): Promise<TreeEntry[]> {
    const files = this.trees.get(treeSha);
    if (files === undefined) {
      throw new ForgeError("NotFound", { message: `unknown tree ${treeSha}` });
    }

    const dirOrder: string[] = [];
    const dirFiles = new Map<string, Map<string, string>>();
    for (const [path, blobSha] of files) {
      const segments = path.split("/");
      for (let i = 1; i < segments.length; i++) {
        const dirPath = segments.slice(0, i).join("/");
        const relPath = segments.slice(i).join("/");
        let relFiles = dirFiles.get(dirPath);
        if (relFiles === undefined) {
          relFiles = new Map();
          dirFiles.set(dirPath, relFiles);
          dirOrder.push(dirPath);
        }
        relFiles.set(relPath, blobSha);
      }
    }

    const entries: TreeEntry[] = [];
    for (const [path, blobSha] of files) {
      entries.push({ path, type: "blob", sha: blobSha });
    }
    for (const dirPath of dirOrder) {
      const relFiles = dirFiles.get(dirPath);
      if (relFiles === undefined) {
        continue;
      }
      const sha = await sha1Hex(canonicalTree(relFiles));
      entries.push({ path: dirPath, type: "tree", sha });
    }

    entries.sort(byPath);
    return entries;
  }

  async applyChanges(
    treeSha: string | null,
    changes: readonly CommitFileChange[],
  ): Promise<string> {
    const base = treeSha === null ? undefined : this.trees.get(treeSha);
    if (treeSha !== null && base === undefined) {
      throw new ForgeError("NotFound", { message: `unknown tree ${treeSha}` });
    }
    const files = new Map<string, string>(base ?? []);

    for (const change of changes) {
      if (change.kind === "upsert-text") {
        const blobSha = await this.putBlob(change.text);
        files.set(change.path, blobSha);
      } else if (change.kind === "upsert-bytes") {
        files.set(change.path, await this.putBlobBytes(change.bytes));
      } else if (change.kind === "upsert-blob") {
        if (!this.blobs.has(change.blobSha)) {
          throw new ForgeError("NotFound", {
            message: `unknown blob ${change.blobSha}`,
          });
        }
        files.set(change.path, change.blobSha);
      } else {
        files.delete(change.path);
      }
    }

    return this.putTree(files);
  }
}

export async function commitFiles(
  repo: InMemoryGitRepo,
  input: {
    parent: string | null;
    files: Record<string, string>;
    binaryFiles?: Readonly<Record<string, Uint8Array>>;
    message: string;
    branch?: string;
    committedAt?: number;
  },
): Promise<string> {
  const entries = await Promise.all(
    Object.entries(input.files).map(
      async ([path, text]): Promise<[string, string]> => [
        path,
        await repo.putBlob(text),
      ],
    ),
  );
  const binaryEntries = await Promise.all(
    Object.entries(input.binaryFiles ?? {}).map(
      async ([path, bytes]): Promise<[string, string]> => [
        path,
        await repo.putBlobBytes(bytes),
      ],
    ),
  );
  const treeSha = await repo.putTree(new Map([...entries, ...binaryEntries]));
  const commitSha = await repo.putCommit({
    tree: treeSha,
    parent: input.parent,
    message: input.message,
    committedAt: input.committedAt,
  });
  if (input.branch !== undefined) {
    repo.setRef(input.branch, commitSha);
  }
  return commitSha;
}

/** Commits `changes` on top of the branch's tip and moves the branch to it. */
export async function commitOnBranch(
  repo: InMemoryGitRepo,
  changes: readonly CommitFileChange[],
  message: string,
  branch: string = MAIN_BRANCH,
): Promise<string> {
  const parent = repo.getRef(branch) ?? null;
  const parentCommit = parent === null ? undefined : repo.getCommit(parent);
  const tree = await repo.applyChanges(parentCommit?.tree ?? null, changes);
  const sha = await repo.putCommit({ tree, parent, message });
  repo.setRef(branch, sha);
  return sha;
}

/** Replays full-snapshot commits, oldest first; only the last one gets `branch`. */
export async function seedCommits(
  repo: InMemoryGitRepo,
  commits: readonly {
    readonly message: string;
    readonly files: Readonly<Record<string, string>>;
    readonly binaryFiles?: Readonly<Record<string, Uint8Array>>;
    readonly committedAt?: number;
  }[],
  branch: string = MAIN_BRANCH,
): Promise<void> {
  let parent: string | null = null;
  for (const [index, commit] of commits.entries()) {
    parent = await commitFiles(repo, {
      parent,
      files: { ...commit.files },
      binaryFiles: { ...commit.binaryFiles },
      message: commit.message,
      committedAt: commit.committedAt,
      branch: index === commits.length - 1 ? branch : undefined,
    });
  }
}
