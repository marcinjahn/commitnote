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
}

export type CommitResult =
  { readonly kind: "ok"; readonly head: string } | { readonly kind: "stale" };

export type RepoInspection =
  | { readonly kind: "empty"; readonly canWrite: boolean }
  | {
      readonly kind: "populated";
      readonly canWrite: boolean;
      readonly main: {
        readonly head: string;
        readonly repoConfigText: string | null;
      } | null;
    };

export type ContentCreatingOperation =
  | "initialize"
  | "createRef"
  | "createBlob"
  | "createTree"
  | "createCommit"
  | "updateRef";

export interface ContentCreatingRequest {
  readonly operation: ContentCreatingOperation;
}

export interface ForgeAdapterOptions {
  readonly accessToken: string;
  readonly onContentCreatingRequest?: (request: ContentCreatingRequest) => void;
}

export interface ForgeAdapter {
  inspect(): Promise<RepoInspection>;
  initialize(configText: string, message: string): Promise<CommitResult>;
  getHead(): Promise<string>;
  listTree(commitSha: string): Promise<TreeEntry[]>;
  readBlob(sha: string): Promise<string>;
  commit(request: CommitRequest): Promise<CommitResult>;
}
