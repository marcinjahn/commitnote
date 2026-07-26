export type ForgeErrorKind =
  | "Unauthorized"
  | "Forbidden"
  | "NotFound"
  | "RateLimited"
  | "Network"
  | "Server"
  | "TreeTruncated";

export class ForgeError extends Error {
  readonly kind: ForgeErrorKind;
  readonly retryAfterMs: number | undefined;
  readonly status: number | undefined;

  constructor(
    kind: ForgeErrorKind,
    options?: {
      message?: string;
      retryAfterMs?: number;
      status?: number;
      cause?: unknown;
    },
  ) {
    super(options?.message ?? kind, { cause: options?.cause });
    this.name = "ForgeError";
    this.kind = kind;
    this.retryAfterMs =
      kind === "RateLimited"
        ? (options?.retryAfterMs ?? 60_000)
        : options?.retryAfterMs;
    this.status = options?.status;
    Object.setPrototypeOf(this, ForgeError.prototype);
  }
}

export function isForgeError(
  value: unknown,
  kind?: ForgeErrorKind,
): value is ForgeError {
  return (
    value instanceof ForgeError && (kind === undefined || value.kind === kind)
  );
}
