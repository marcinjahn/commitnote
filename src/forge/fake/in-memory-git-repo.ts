import { ForgeError } from "../errors";
import type { CommitFileChange, TreeEntry } from "../forge-adapter";

interface StoredCommit {
  readonly tree: string;
  readonly parent: string | null;
  readonly message: string;
}

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
 * branch refs. Reused by the fake forge adapter and, later, the mock
 * GitHub server.
 */
export class InMemoryGitRepo {
  private readonly blobs = new Map<string, string>();
  private readonly trees = new Map<string, ReadonlyMap<string, string>>();
  private readonly commits = new Map<string, StoredCommit>();
  private readonly refs = new Map<string, string>();
  private commitSeq = 0;

  async putBlob(text: string): Promise<string> {
    const contentBytes = new TextEncoder().encode(text);
    const header = new TextEncoder().encode(
      `blob ${contentBytes.byteLength}\0`,
    );
    const full = new Uint8Array(header.byteLength + contentBytes.byteLength);
    full.set(header, 0);
    full.set(contentBytes, header.byteLength);
    const digest = await crypto.subtle.digest("SHA-1", full);
    const sha = toHex(digest);
    this.blobs.set(sha, text);
    return sha;
  }

  getBlob(sha: string): string | undefined {
    return this.blobs.get(sha);
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
  }): Promise<string> {
    const seq = this.commitSeq++;
    const content = `commit\ntree ${input.tree}\nparent ${input.parent ?? ""}\nseq ${seq}\n\n${input.message}\n`;
    const sha = await sha1Hex(content);
    this.commits.set(sha, {
      tree: input.tree,
      parent: input.parent,
      message: input.message,
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

  hasCommits(): boolean {
    return this.commits.size > 0;
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

    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
    message: string;
    branch?: string;
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
  const treeSha = await repo.putTree(new Map(entries));
  const commitSha = await repo.putCommit({
    tree: treeSha,
    parent: input.parent,
    message: input.message,
  });
  if (input.branch !== undefined) {
    repo.setRef(input.branch, commitSha);
  }
  return commitSha;
}
