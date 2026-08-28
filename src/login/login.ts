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
import { parseRepoConfig } from "../crypto/repo-config";
import { isForgeError } from "../forge/errors";
import type {
  CommitResult,
  ForgeAdapter,
  RepoInspection,
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
  | { readonly kind: "newerFormat"; readonly formatVersion: number }
  | { readonly kind: "wrongPassphrase" }
  | { readonly kind: "initializationRaced" };

export type LoginStep =
  | "listingRepositories"
  | "checkingRepository" | "derivingKeys" | "initializing";

export interface LoginInput {
  readonly repository: RepositorySummary;
  readonly accessToken: string;
  readonly passphrase: string;
}

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
}

export type LoginResult =
  | {
      readonly kind: "loggedIn";
      readonly session: Session;
      readonly adapter: ForgeAdapter;
    }
  | {
      readonly kind: "needsInitialization";
      readonly pending: PendingInitialization;
    }
  | { readonly kind: "failed"; readonly error: LoginError };

type RepositoryCheck =
  | { readonly kind: "empty" }
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

  if (inspection.main === null || inspection.main.repoConfigText === null) {
    return { kind: "error", error: { kind: "foreign" } };
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

export async function logIn(
  input: LoginInput,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<LoginResult> {
  const { url: repoUrl, coordinates } = input.repository;
  const accessToken = input.accessToken.trim();

  const adapter = deps.createAdapter(coordinates, { accessToken });

  const check = await checkRepository(adapter, onStep);
  if (check.kind === "error") {
    return { kind: "failed", error: check.error };
  }
  if (check.kind === "empty") {
    return {
      kind: "needsInitialization",
      pending: { repoUrl, coordinates, accessToken, adapter },
    };
  }

  onStep?.("derivingKeys");
  const keyring = await deriveKeyring(
    input.passphrase,
    check.config.kdf,
    deps.argon2id,
  );
  const verified = await verifyKeyCheck(keyring, check.config);
  if (!verified) {
    return { kind: "failed", error: { kind: "wrongPassphrase" } };
  }

  return {
    kind: "loggedIn",
    session: { repoUrl, coordinates, accessToken, keyring },
    adapter,
  };
}

export async function initializeNotesRepo(
  pending: PendingInitialization,
  passphrase: string,
  deps: LoginDependencies,
  onStep?: (step: LoginStep) => void,
): Promise<Exclude<LoginResult, { kind: "needsInitialization" }>> {
  onStep?.("derivingKeys");
  const { configText, keyring } = await createRepoConfig(passphrase, {
    argon2id: deps.argon2id,
    random: deps.random,
    now: deps.now,
  });

  onStep?.("initializing");
  let result: CommitResult;
  try {
    result = await pending.adapter.initialize(
      configText,
      encodeInitializeMessage(),
    );
  } catch (error) {
    return { kind: "failed", error: mapInitializeError(error) };
  }

  if (result.kind === "stale") {
    return { kind: "failed", error: { kind: "initializationRaced" } };
  }

  try {
    await pending.adapter.commit({
      parent: result.head,
      changes: [{ kind: "upsert-text", path: README_PATH, text: README_TEXT }],
      message: README_COMMIT_MESSAGE,
    });
  } catch {
    // The README is informational; the initialized repo is already usable.
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
): Promise<Exclude<LoginResult, { kind: "needsInitialization" }>> {
  const adapter = deps.createAdapter(session.coordinates, {
    accessToken: session.accessToken,
  });

  const check = await checkRepository(adapter, onStep);
  if (check.kind === "error") {
    return { kind: "failed", error: check.error };
  }
  if (check.kind === "empty") {
    return { kind: "failed", error: { kind: "foreign" } };
  }

  const verified = await verifyKeyCheck(session.keyring, check.config);
  if (!verified) {
    return { kind: "failed", error: { kind: "wrongPassphrase" } };
  }

  return { kind: "loggedIn", session, adapter };
}
