import {
  isTransient,
  type LoginError,
  type RepositoryListResult,
} from "../login/login";
import type { SyncError } from "../sync/sync-engine";
import { describeSyncError } from "../ui/browse/sync-messages";
import {
  describeLoginError,
  GENERIC_LOGIN_ERROR,
} from "../ui/login/login-messages";
import type { CoreError, CoreErrorKind } from "./api";

export const CORE_GENERIC_MESSAGE = GENERIC_LOGIN_ERROR;

type CoreLevelKind = Extract<
  CoreErrorKind,
  "unknownCommand" | "invalidParams" | "notReady" | "internal"
>;

const LOGIN_KINDS: ReadonlySet<string> = new Set<LoginError["kind"]>([
  "unauthorized",
  "noAccess",
  "rateLimited",
  "network",
  "server",
  "readOnly",
  "foreign",
  "noMainBranch",
  "newerFormat",
  "wrongPassphrase",
  "initializationRaced",
  "repositoryChanged",
]);

const SYNC_KINDS: ReadonlySet<string> = new Set<SyncError["kind"]>([
  "unauthorized",
  "forbidden",
  "notFound",
  "network",
  "server",
  "treeTruncated",
  "undecryptable",
  "keyChanged",
  "rateLimited",
]);

export function coreLevelError(kind: CoreLevelKind): CoreError {
  return { kind, message: CORE_GENERIC_MESSAGE, transient: false };
}

function kindOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const kind = (error as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

function withRetryAfter(
  base: CoreError,
  error: LoginError | SyncError,
): CoreError {
  return error.kind === "rateLimited"
    ? { ...base, retryAfterMs: error.retryAfterMs }
    : base;
}

export function toCoreError(
  error: unknown,
  context: { readonly source: "login" | "sync"; readonly forgeName: string },
): CoreError {
  const kind = kindOf(error);
  if (context.source === "login" && kind !== null && LOGIN_KINDS.has(kind)) {
    const loginError = error as LoginError;
    const base: CoreError = {
      kind: loginError.kind,
      message: describeLoginError(loginError, context.forgeName),
      transient: isTransient(loginError),
    };
    if (loginError.kind === "newerFormat") {
      return { ...base, formatVersion: loginError.formatVersion };
    }
    return withRetryAfter(base, loginError);
  }
  if (context.source === "sync" && kind !== null && SYNC_KINDS.has(kind)) {
    const syncError = error as SyncError;
    return withRetryAfter(
      {
        kind: syncError.kind,
        message: describeSyncError(syncError, context.forgeName),
        transient:
          syncError.kind === "network" ||
          syncError.kind === "server" ||
          syncError.kind === "rateLimited",
      },
      syncError,
    );
  }
  return coreLevelError("internal");
}

export function toCoreErrorFromForge(
  result: Extract<RepositoryListResult, { kind: "failed" }>,
  forgeName: string,
): CoreError {
  return toCoreError(result.error, { source: "login", forgeName });
}
