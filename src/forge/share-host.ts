export type ShareLocator =
  | {
      readonly provider: "github";
      readonly gistId: string;
      readonly revision: string;
    }
  | { readonly provider: "gitlab"; readonly snippetId: string };

export interface ShareHost {
  create(envelope: string): Promise<ShareLocator>;
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

export interface ShareReader {
  read(locator: ShareLocator): Promise<string>;
}

export type ShareReaders = Readonly<Record<ShareLocator["provider"], ShareReader>>;
