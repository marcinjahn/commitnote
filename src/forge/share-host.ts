export type ShareLocator =
  | { readonly provider: "github"; readonly gistId: string }
  | { readonly provider: "gitlab"; readonly snippetId: string };

export interface ShareContent {
  readonly envelope: string;
  readonly images: readonly string[];
}

export interface ShareHost {
  readonly maxImages: number;
  create(content: ShareContent): Promise<ShareLocator>;
  update(locator: ShareLocator, content: ShareContent): Promise<void>;
  delete(locator: ShareLocator): Promise<void>;
}

export type ShareReadErrorKind =
  | "notFound"
  | "rateLimited"
  | "network"
  | "server"
  | "damaged";

export class ShareReadError extends Error {
  constructor(readonly kind: ShareReadErrorKind) {
    super(`Share read failed: ${kind}`);
    this.name = "ShareReadError";
  }
}

export interface HostedShare {
  readonly envelope: string;
  readImageFile(file: string): Promise<string>;
}

export interface ShareReader {
  read(locator: ShareLocator): Promise<HostedShare>;
}

export type ShareReaders = Readonly<Record<ShareLocator["provider"], ShareReader>>;
