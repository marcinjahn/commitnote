import { encodeInitializeMessage } from "../changes/encode-change-set";
import {
  README_COMMIT_MESSAGE,
  README_PATH,
  README_TEXT,
} from "./repo-readme";
import type { Argon2idFunction } from "../crypto/argon2";
import {
  createRepoConfig,
  deriveKeyring,
  verifyKeyCheck,
} from "../crypto/keyring";
import type { RandomSource } from "../crypto/random";
import type { RepoConfig } from "../crypto/repo-config";
import { parseRepoConfig, serializeRepoConfig } from "../crypto/repo-config";
import { REPO_CONFIG_PATH } from "../format/v1";
import { isForgeError } from "../forge/errors";
import type {
  CommitResult,
  ForgeAdapter,
  RepoInspection,
  RootEntry,
} from "../forge/forge-adapter";
import type { ForgeProvider, RepositorySummary } from "../forge/forge-provider";
import type { ForgeAdapterFactory } from "../forge/registry";
import type { RepoCoordinates } from "../forge/repo-coordinates";
import type { Session } from "../session/session";

export type LoginError =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "noAccess" }
  | { readonly kind: "rateLimited"; readonly retryAfterMs: number }
  | { readonly kind: "network" }
  | { readonly kind: "server" }
  | { readonly kind: "readOnly" }
  | { readonly kind: "foreign" }
  | { readonly kind: "noMainBranch" }
  | { readonly kind: "newerFormat"; readonly formatVersion: number }
  | { readonly kind: "wrongPassphrase" }
  | { readonly kind: "initializationRaced" }
  | { readonly kind: "repositoryChanged" };

export type LoginStep =
  | "listingRepositories"
  | "checkingRepository" | "derivingKeys" | "initializing";

export interface LoginDependencies {
  readonly createAdapter: ForgeAdapterFactory;
  readonly argon2id?: Argon2idFunction;
  readonly random?: RandomSource;
  readonly now?: () => Date;
}

export interface PendingInitialization {
  readonly repoUrl: string;
  readonly coordinates: RepoCoordinates;
  readonly accessToken: string;
  readonly adapter: ForgeAdapter;
  /** Null for an empty repository; otherwise main's head, which is kept. */
  readonly base: { readonly head: string; readonly hasReadme: boolean } | null;
  readonly existingFiles: readonly string[];
}

export interface NotesRepoTarget {
  readonly repoUrl: string;
  readonly coordinates: RepoCoordinates;
  readonly accessToken: string;
  readonly adapter: ForgeAdapter;
  readonly config: RepoConfig;
}

export type RepositoryState =
  | { readonly kind: "notesRepo"; readonly target: NotesRepoTarget }
  | { readonly kind: "uninitialized"; readonly pending: PendingInitialization }
  | { readonly kind: "unusable"; readonly error: LoginError };

export type LoginResult =
  | {
      readonly kind: "loggedIn";
      readonly session: Session;
      readonly adapter: ForgeAdapter;
    }
  | { readonly kind: "failed"; readonly error: LoginError };

export type UnlockResult =
  | Extract<LoginResult, { kind: "loggedIn" }>
  | {
      readonly kind: "failed";
      readonly error: LoginError;
      /** The notes repo as re-read after its config turned out to have changed. */
      readonly target?: NotesRepoTarget;
    };

type RepositoryCheck =
  | { readonly kind: "empty" }
  | {
      readonly kind: "almostEmpty";
      readonly head: string;
      readonly hasReadme: boolean;
      readonly existingFiles: readonly string[];
    }
  | { readonly kind: "config"; readonly config: RepoConfig }
  | { readonly kind: "error"; readonly error: LoginError };

function mapInspectError(error: unknown): LoginError {
  if (!isForgeError(error)) throw error;
  switch (error.kind) {
    case "Unauthorized":
      return { kind: "unauthorized" };
    case "NotFound":
    case "Forbidden":
      return { kind: "noAccess" };
    case "RateLimited":
      return {
        kind: "rateLimited",
        retryAfterMs: error.retryAfterMs ?? 60_000,
      };
    case "Network":
      return { kind: "network" };
    case "Server":
    case "TreeTruncated":
      return { kind: "server" };
  }
}

function mapInitializeError(error: unknown): LoginError {
  if (!isForgeError(error)) throw error;
  if (error.kind === "Forbidden") return { kind: "readOnly" };
  return mapInspectError(error);
}

function isTransient(error: LoginError): boolean {
  return (
    error.kind === "network" ||
    error.kind === "server" ||
    error.kind === "rateLimited"
  );
}

const README_NAME = /^readme(\..+)?$/i;
const LICENSE_NAME = /^(licen[cs]e|copying)(\.(md|markdown|txt|rst))?$/i;

export type RootClassification =
  | { readonly kind: "almostEmpty"; readonly hasReadme: boolean }
  | { readonly kind: "foreign" };

/** Whether a root without a repo config holds only files a forge adds to a new repository. */
export function classifyRoot(
  entries: readonly RootEntry[],
): RootClassification {
  let hasReadme = false;
  for (const entry of entries) {
    if (entry.type !== "blob") return { kind: "foreign" };
    if (README_NAME.test(entry.name)) {
      hasReadme = true;
    } else if (!LICENSE_NAME.test(entry.name) && entry.name !== ".gitignore") {
      return { kind: "foreign" };
    }
  }
  return { kind: "almostEmpty", hasReadme };
}

async function checkRepository(
  adapter: ForgeAdapter,
  onStep?: (step: LoginStep) => void,
): Promise<RepositoryCheck> {
  onStep?.("checkingRepository");

  let inspection: RepoInspection;
  try {
    inspection = await adapter.inspect();
  } catch (error) {
    return { kind: "error", error: mapInspectError(error) };
  }

  if (inspection.canWrite === false) {
    return { kind: "error", error: { kind: "readOnly" } };
  }

  if (inspection.kind === "empty") {
    return { kind: "empty" };
  }

  if (inspection.main === null) {
    return { kind: "error", error: { kind: "noMainBranch" } };
  }

  if (inspection.main.repoConfigText === null) {
    const rootEntries = inspection.main.rootEntries;
    const root = rootEntries === null ? null : classifyRoot(rootEntries);
    if (rootEntries === null || root?.kind !== "almostEmpty") {
      return { kind: "error", error: { kind: "foreign" } };
    }
    return {
      kind: "almostEmpty",
      head: inspection.main.head,
      hasReadme: root.hasReadme,
      existingFiles: rootEntries.map((entry) => entry.name),
    };
  }

  const parsed = parseRepoConfig(inspection.main.repoConfigText);
  if (parsed.kind === "invalid") {
    return { kind: "error", error: { kind: "foreign" } };
  }
  if (parsed.kind === "newerFormat") {
    return {
      kind: "error",
      error: { kind: "newerFormat", formatVersion: parsed.formatVersion },
    };
  }

  return { kind: "config", config: parsed.config };
}

export type RepositoryListResult =
  | { readonly kind: "listed"; readonly repositories: RepositorySummary[] }
  | { readonly kind: "failed"; readonly error: LoginError };

export function repositoryLabel(coordinates: RepoCoordinates): string {
  return `${coordinates.owner}/${coordinates.repo}`;
}

export async function listRepositories(
  provider: ForgeProvider,
  accessToken: string,
): Promise<RepositoryListResult> {
  let repositories: RepositorySummary[];
  try {
    repositories = await provider.listRepositories(accessToken.trim());
  } catch (error) {
    return { kind: "failed", error: mapInspectError(error) };
  }
  const sorted = repositories.toSorted((a, b) =>
    repositoryLabel(a.coordinates).localeCompare(
      repositoryLabel(b.coordinates),
    ),
  );
  return { kind: "listed", repositories: sorted };
}

export async function inspectRepository(
  repository: RepositorySummary,
  accessToken: string,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<RepositoryState> {
  const { url: repoUrl, coordinates } = repository;
  const token = accessToken.trim();
  const adapter = deps.createAdapter(coordinates, { accessToken: token });

  const check = await checkRepository(adapter, onStep);
  switch (check.kind) {
    case "error":
      return { kind: "unusable", error: check.error };
    case "config":
      return {
        kind: "notesRepo",
        target: {
          repoUrl,
          coordinates,
          accessToken: token,
          adapter,
          config: check.config,
        },
      };
    case "empty":
    case "almostEmpty":
      return {
        kind: "uninitialized",
        pending: {
          repoUrl,
          coordinates,
          accessToken: token,
          adapter,
          base:
            check.kind === "empty"
              ? null
              : { head: check.head, hasReadme: check.hasReadme },
          existingFiles: check.kind === "empty" ? [] : check.existingFiles,
        },
      };
  }
}

async function unlockWithConfig(
  target: NotesRepoTarget,
  passphrase: string,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<Extract<LoginResult, { kind: "loggedIn" }> | null> {
  onStep?.("derivingKeys");
  const keyring = await deriveKeyring(
    passphrase,
    target.config.kdf,
    deps.argon2id,
  );
  if (!(await verifyKeyCheck(keyring, target.config))) return null;
  const { repoUrl, coordinates, accessToken, adapter } = target;
  return {
    kind: "loggedIn",
    session: { repoUrl, coordinates, accessToken, keyring },
    adapter,
  };
}

/**
 * Verifies against the config read when the repository was inspected; when
 * that fails, re-reads the repository once, since the passphrase may have
 * been changed on another device in the meantime.
 */
export async function unlockNotesRepo(
  target: NotesRepoTarget,
  passphrase: string,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<UnlockResult> {
  const wrongPassphrase = {
    kind: "failed",
    error: { kind: "wrongPassphrase" },
  } as const;

  const unlocked = await unlockWithConfig(target, passphrase, deps, onStep);
  if (unlocked !== null) return unlocked;

  const check = await checkRepository(target.adapter, onStep);
  switch (check.kind) {
    case "error":
      return isTransient(check.error)
        ? wrongPassphrase
        : { kind: "failed", error: check.error };
    case "empty":
    case "almostEmpty":
      return { kind: "failed", error: { kind: "repositoryChanged" } };
    case "config": {
      if (
        serializeRepoConfig(check.config) === serializeRepoConfig(target.config)
      ) {
        return wrongPassphrase;
      }
      const refreshed: NotesRepoTarget = { ...target, config: check.config };
      return (
        (await unlockWithConfig(refreshed, passphrase, deps, onStep)) ?? {
          ...wrongPassphrase,
          target: refreshed,
        }
      );
    }
  }
}

export async function initializeNotesRepo(
  pending: PendingInitialization,
  passphrase: string,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<LoginResult> {
  onStep?.("derivingKeys");
  const { configText, keyring } = await createRepoConfig(passphrase, {
    argon2id: deps.argon2id,
    random: deps.random,
    now: deps.now,
  });

  onStep?.("initializing");
  let result: CommitResult;
  try {
    result =
      pending.base === null
        ? await pending.adapter.initialize(
            configText,
            encodeInitializeMessage(),
          )
        : await pending.adapter.commit({
            parent: pending.base.head,
            changes: [
              { kind: "upsert-text", path: REPO_CONFIG_PATH, text: configText },
            ],
            message: encodeInitializeMessage(),
          });
  } catch (error) {
    // GitLab can apply the config commit on top of an unrelated commit that
    // landed after its head check, and then fails with Server.
    if (
      pending.base !== null &&
      isForgeError(error) &&
      error.kind === "Server"
    ) {
      return { kind: "failed", error: { kind: "initializationRaced" } };
    }
    return { kind: "failed", error: mapInitializeError(error) };
  }

  if (result.kind === "stale") {
    return { kind: "failed", error: { kind: "initializationRaced" } };
  }

  if (pending.base === null || !pending.base.hasReadme) {
    try {
      await pending.adapter.commit({
        parent: result.head,
        changes: [
          { kind: "upsert-text", path: README_PATH, text: README_TEXT },
        ],
        message: README_COMMIT_MESSAGE,
      });
    } catch {
      // The README is informational; the initialized repo is already usable.
    }
  }

  const session: Session = {
    repoUrl: pending.repoUrl,
    coordinates: pending.coordinates,
    accessToken: pending.accessToken,
    keyring,
  };
  return { kind: "loggedIn", session, adapter: pending.adapter };
}

export async function resumeSession(
  session: Session,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<LoginResult> {
  const adapter = deps.createAdapter(session.coordinates, {
    accessToken: session.accessToken,
  });

  const check = await checkRepository(adapter, onStep);
  if (check.kind === "error") {
    return { kind: "failed", error: check.error };
  }
  if (check.kind === "empty" || check.kind === "almostEmpty") {
    return { kind: "failed", error: { kind: "foreign" } };
  }

  const verified = await verifyKeyCheck(session.keyring, check.config);
  if (!verified) {
    return { kind: "failed", error: { kind: "wrongPassphrase" } };
  }

  return { kind: "loggedIn", session, adapter };
}
