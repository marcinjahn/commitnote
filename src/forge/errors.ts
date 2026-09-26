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
  /**
   * Set on a commit failure that is known to have left main untouched for
   * good, even when the failure itself (a Network error) leaves the response
   * unknown.
   */
  readonly mainUnchanged: boolean;

  constructor(
    kind: ForgeErrorKind,
    options?: {
      message?: string;
      retryAfterMs?: number;
      status?: number;
      cause?: unknown;
      mainUnchanged?: boolean;
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
    this.mainUnchanged = options?.mainUnchanged ?? false;
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

/** The same error, marked as having left main untouched. */
export function withMainUnchanged(error: ForgeError): ForgeError {
  if (error.mainUnchanged) return error;
  return new ForgeError(error.kind, {
    message: error.message,
    retryAfterMs: error.retryAfterMs,
    status: error.status,
    cause: error.cause,
    mainUnchanged: true,
  });
}
