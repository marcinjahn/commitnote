import type { ShareHost } from "./share-host";

export interface TreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree";
  readonly sha: string;
}

export type CommitFileChange =
  | {
      readonly kind: "upsert-text";
      readonly path: string;
      readonly text: string;
    }
  | {
      readonly kind: "upsert-blob";
      readonly path: string;
      readonly blobSha: string;
    }
  | { readonly kind: "delete"; readonly path: string };

export interface CommitRequest {
  readonly parent: string;
  readonly changes: readonly CommitFileChange[];
  readonly message: string;
  /**
   * For bulk changes that must land as exactly one commit on top of `parent`
   * or not at all. `ok` means main was at `head` and `head`'s only parent is
   * `parent`; `stale` means nothing reached main; an outcome that cannot be
   * determined rejects with a Network ForgeError. Without it, an adapter may
   * use a cheaper path with a narrow race (see the GitLab adapter).
   */
  readonly atomic?: boolean;
  /**
   * Files of `parent` stored under the session's key (notes, folder
   * markers). A passphrase change renames all of them, so an adapter whose
   * plain commit is not a compare-and-swap makes the commit fail if the one
   * it picks is gone, instead of landing old-key files on a re-keyed tree.
   */
  readonly keyBoundFiles?: readonly KeyBoundFile[];
}

export interface KeyBoundFile {
  readonly path: string;
  readonly blobSha: string;
}

export interface ReplaceHistoryRequest {
  /** Main must still be at this commit; its tree is kept. */
  readonly head: string;
  readonly message: string;
}

/** Content-creating requests `replaceHistory` sends. */
export const REPLACE_HISTORY_COST = 2;

export type CommitResult =
  { readonly kind: "ok"; readonly head: string } | { readonly kind: "stale" };

export interface CommitSummary {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly message: string;
  /** Committer time, ms since epoch. */
  readonly committedAt: number;
}

export interface FindOldestCommitRequest {
  from: string;
  path: string;
}

export interface ListCommitsRequest {
  readonly from: string;
  readonly path: string;
  readonly limit: number;
}

export interface FileAtCommit {
  readonly blobSha: string;
  readonly text: string;
}

export interface RootEntry {
  readonly name: string;
  readonly type: "blob" | "tree";
}

export function blobShasByPath(
  entries: readonly TreeEntry[],
): Map<string, string> {
  const shas = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "blob") shas.set(entry.path, entry.sha);
  }
  return shas;
}

/** Adapters may list only this many root entries when a root has more. */
export const ROOT_LISTING_LIMIT = 20;

export type RepoInspection =
  | { readonly kind: "empty"; readonly canWrite: boolean }
  | {
      readonly kind: "populated";
      readonly canWrite: boolean;
      readonly main: {
        readonly head: string;
        readonly repoConfigText: string | null;
        /** Null when the repo config is present. */
        readonly rootEntries: readonly RootEntry[] | null;
      } | null;
    };

export type ContentCreatingOperation =
  | "initialize"
  | "createRef"
  | "createTree"
  | "createCommit"
  | "updateRef"
  | "deleteRef"
  | "createMergeRequest"
  | "mergeMergeRequest"
  | "closeMergeRequest"
  | "updateProject"
  | "createShare"
  | "updateShare"
  | "deleteShare";

export type AtomicCommitSupport =
  | { readonly kind: "available" }
  | {
      readonly kind: "needsSetup";
      /** Whether `enableAtomicCommits` can change the settings for this user. */
      readonly canConfigure: boolean;
    };

export interface ContentCreatingRequest {
  readonly operation: ContentCreatingOperation;
}

export interface ForgeAdapterOptions {
  readonly accessToken: string;
  readonly onContentCreatingRequest?: (request: ContentCreatingRequest) => void;
}

/** Budget for content-creating requests, kept below the provider's limits. */
export interface ForgeWriteLimits {
  readonly perMinute: number;
  readonly perHour: number;
}

export interface ForgeAdapter {
  readonly limits: ForgeWriteLimits;
  readonly shareHost: ShareHost;
  /** Number of content-creating requests `commit` sends for these changes. */
  commitCost(
    changes: readonly CommitFileChange[],
    options?: { readonly atomic?: boolean },
  ): number;
  inspect(): Promise<RepoInspection>;
  initialize(configText: string, message: string): Promise<CommitResult>;
  getHead(): Promise<string>;
  listTree(commitSha: string): Promise<TreeEntry[]>;
  readBlob(sha: string): Promise<string>;
  commit(request: CommitRequest): Promise<CommitResult>;
  /**
   * Newest first: commits reachable from `from` (inclusive) that changed the
   * file at `path`, at most `limit`. Fewer only when no older commit changed
   * it. Rejects with NotFound when `from` is unknown.
   */
  listCommits(request: ListCommitsRequest): Promise<CommitSummary[]>;
  /**
   * The oldest commit reachable from `from` (first-parent history, inclusive)
   * that changed the file at `path`, or null when none did. Rejects with
   * NotFound when `from` is unknown.
   */
  findOldestCommit(request: FindOldestCommitRequest): Promise<CommitSummary | null>;
  /** Null when `path` is not a file in that commit. */
  readFileAt(commitSha: string, path: string): Promise<FileAtCommit | null>;
  /**
   * Absent when atomic commits always work. An atomic commit rejects with a
   * Forbidden ForgeError while this reports `needsSetup`.
   */
  atomicCommitSupport?(): Promise<AtomicCommitSupport>;
  /** Changes repository settings so that atomic commits work. */
  enableAtomicCommits?(): Promise<AtomicCommitSupport>;
  /**
   * Points main at a new parentless commit holding `head`'s tree, so every
   * earlier commit drops out of main's history. Resolves `stale` when main
   * moved on. Absent when the forge can't create a parentless commit.
   */
  replaceHistory?(request: ReplaceHistoryRequest): Promise<CommitResult>;
  /** Removes leftovers of interrupted atomic commits. Best-effort. */
  sweepAbandoned?(): Promise<void>;
}
