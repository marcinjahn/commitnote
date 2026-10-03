import { encodeChangePassphraseMessage } from "../changes/encode-change-set";
import type { Argon2idFunction } from "../crypto/argon2";
import {
  createRepoConfig,
  deriveKeyring,
  verifyKeyCheck,
  type Keyring,
} from "../crypto/keyring";
import type { RandomSource } from "../crypto/random";
import { parseRepoConfig, serializeRepoConfig } from "../crypto/repo-config";
import { isForgeError } from "../forge/errors";
import type {
  AtomicCommitSupport,
  CommitFileChange,
  CommitResult,
  ForgeAdapter,
} from "../forge/forge-adapter";
import { REPLACE_HISTORY_COST } from "../forge/forge-adapter";
import { REPO_CONFIG_PATH } from "../format/v1";
import type { Clock } from "../sync/clock";
import type { RateBudget } from "../sync/rate-budget";
import {
  mapForgeError,
  type SyncEngine,
  type SyncError,
} from "../sync/sync-engine";
import { planRekey, RekeyPlanError, type RekeySummary } from "./plan-rekey";
import { expectedTree, sameTree } from "./expected-tree";
import { readBlobs } from "./read-blobs";
import { verifyRekey } from "./verify-rekey";

/** Longer rate-budget waits fail the change instead of stalling it. */
export const MAX_BUDGET_WAIT_MS = 120_000;

export interface PassphraseChangeDeps {
  readonly adapter: ForgeAdapter;
  readonly engine: Pick<
    SyncEngine,
    "flush" | "getState" | "suspend" | "resume" | "refresh"
  >;
  readonly rateBudget: RateBudget;
  readonly clock: Clock;
  readonly argon2id?: Argon2idFunction;
  readonly random?: RandomSource;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type PassphraseChangeStep =
  | { readonly kind: "saving" }
  | { readonly kind: "checkingPassphrase" }
  | { readonly kind: "derivingKeys" }
  | { readonly kind: "reading"; readonly done: number; readonly total: number }
  | {
      readonly kind: "encrypting";
      readonly done: number;
      readonly total: number;
    }
  | { readonly kind: "verifying" }
  | { readonly kind: "waitingForBudget"; readonly until: number }
  | { readonly kind: "uploading" }
  | { readonly kind: "confirming" }
  | { readonly kind: "removingHistory" };

export type PassphraseChangeFailure =
  | {
      readonly kind:
        | "emptyPassphrase"
        | "samePassphrase"
        | "unavailable"
        | "conflicts"
        | "wrongPassphrase"
        /** The notes changed on another device; nothing was changed. */
        | "changedElsewhere"
        | "undecryptableNote"
        | "invalidName"
        | "verificationFailed"
        /** The commit may still have landed; the key guard covers both cases. */
        | "outcomeUnknown";
    }
  | { readonly kind: "unsaved"; readonly count: number }
  | { readonly kind: "needsSetup"; readonly canConfigure: boolean }
  | { readonly kind: "rateBudget"; readonly retryAt: number }
  | { readonly kind: "forge"; readonly error: SyncError };

export interface PreparedPassphraseChange {
  readonly summary: RekeySummary;
  readonly parent: string;
  readonly changes: readonly CommitFileChange[];
  readonly keyring: Keyring;
  /** Blob SHA of every file main must hold once the change landed. */
  readonly expected: ReadonlyMap<string, string>;
  /** Replace main's history with the change's commit once it landed. */
  readonly removeHistory: boolean;
}

export interface PassphraseChangeInput {
  readonly currentPassphrase: string;
  readonly newPassphrase: string;
  readonly removeHistory?: boolean;
}

export type PrepareResult =
  | { readonly ok: true; readonly prepared: PreparedPassphraseChange }
  | { readonly ok: false; readonly failure: PassphraseChangeFailure };

/**
 * `mismatch`: the commit landed, so the repo is on the new key, but main does
 * not hold exactly the verified files. `unchecked`: main could not be read
 * back to compare.
 */
export type LandedCheck = "matched" | "mismatch" | "unchecked";

/** `kept`: removing the history was not asked for. */
export type HistoryOutcome = "kept" | "removed" | "notRemoved";

export type CommitPassphraseChangeResult =
  | {
      readonly ok: true;
      readonly keyring: Keyring;
      readonly check: LandedCheck;
      readonly history: HistoryOutcome;
    }
  | {
      readonly ok: false;
      readonly failure: PassphraseChangeFailure;
      /**
       * The engine stays suspended: the change may still land, so nothing
       * may be written with the old key until `settle` tells.
       */
      readonly unsettled?: boolean;
    };

class ChangeFailed extends Error {
  constructor(readonly failure: PassphraseChangeFailure) {
    super(`Passphrase change failed: ${failure.kind}`);
  }
}

function fail(failure: PassphraseChangeFailure): never {
  throw new ChangeFailed(failure);
}

function toFailure(error: unknown): PassphraseChangeFailure {
  if (error instanceof ChangeFailed) return error.failure;
  if (error instanceof RekeyPlanError) {
    return {
      kind: error.kind === "invalidName" ? "invalidName" : "undecryptableNote",
    };
  }
  if (isForgeError(error)) {
    return { kind: "forge", error: mapForgeError(error) };
  }
  console.error(
    "Passphrase change failed",
    error instanceof Error ? error.name : typeof error,
  );
  return { kind: "forge", error: { kind: "server" } };
}

function sleepFor(deps: PassphraseChangeDeps): (ms: number) => Promise<void> {
  return (
    deps.sleep ??
    ((ms) => new Promise((resolve) => deps.clock.setTimeout(resolve, ms)))
  );
}

function abort(deps: PassphraseChangeDeps): void {
  deps.engine.resume();
  void deps.engine.refresh().catch(() => {});
}

/** Leaves the engine running again after a prepared change is not committed. */
export function cancelPassphraseChange(deps: PassphraseChangeDeps): void {
  abort(deps);
}

async function suspendEngine(deps: PassphraseChangeDeps): Promise<void> {
  const { engine } = deps;
  const initial = engine.getState();
  if (initial.stopped !== null || initial.synced === null) {
    fail({ kind: "unavailable" });
  }
  if (initial.conflicts.length > 0) fail({ kind: "conflicts" });
  const flushed = await engine.flush();
  if (flushed.kind === "unsaved") {
    fail({ kind: "unsaved", count: flushed.count });
  }
  if (engine.suspend()) return;
  const state = engine.getState();
  if (state.conflicts.length > 0) fail({ kind: "conflicts" });
  if (state.syncStates.unsavedCount > 0) {
    fail({ kind: "unsaved", count: state.syncStates.unsavedCount });
  }
  fail({ kind: "unavailable" });
}

/**
 * Saves everything, suspends the engine and builds the re-encrypted tree in
 * memory. On success the engine stays suspended until the change is
 * committed or cancelled; on failure it is running again.
 */
export async function preparePassphraseChange(
  deps: PassphraseChangeDeps,
  input: PassphraseChangeInput,
  onStep: (step: PassphraseChangeStep) => void = () => {},
): Promise<PrepareResult> {
  if (input.newPassphrase.trim() === "") {
    return { ok: false, failure: { kind: "emptyPassphrase" } };
  }
  if (
    input.newPassphrase.normalize("NFC") ===
    input.currentPassphrase.normalize("NFC")
  ) {
    return { ok: false, failure: { kind: "samePassphrase" } };
  }

  onStep({ kind: "saving" });
  try {
    await suspendEngine(deps);
  } catch (error) {
    return { ok: false, failure: toFailure(error) };
  }

  try {
    return { ok: true, prepared: await buildChange(deps, input, onStep) };
  } catch (error) {
    abort(deps);
    return { ok: false, failure: toFailure(error) };
  }
}

async function buildChange(
  deps: PassphraseChangeDeps,
  input: PassphraseChangeInput,
  onStep: (step: PassphraseChangeStep) => void,
): Promise<PreparedPassphraseChange> {
  const { adapter, engine } = deps;

  const support = await adapter.atomicCommitSupport?.();
  if (support?.kind === "needsSetup") {
    fail({ kind: "needsSetup", canConfigure: support.canConfigure });
  }

  const head = await adapter.getHead();
  if (head !== engine.getState().synced?.head)
    fail({ kind: "changedElsewhere" });
  const listing = await adapter.listTree(head);
  const configEntry = listing.find(
    (entry) => entry.type === "blob" && entry.path === REPO_CONFIG_PATH,
  );
  if (configEntry === undefined) fail({ kind: "unavailable" });
  const current = parseRepoConfig(await adapter.readBlob(configEntry.sha));
  if (current.kind !== "valid") fail({ kind: "unavailable" });

  onStep({ kind: "checkingPassphrase" });
  const oldKeyring = await deriveKeyring(
    input.currentPassphrase,
    current.config.kdf,
    deps.argon2id,
  );
  if (!(await verifyKeyCheck(oldKeyring, current.config))) {
    fail({ kind: "wrongPassphrase" });
  }

  onStep({ kind: "derivingKeys" });
  const created = await createRepoConfig(input.newPassphrase, {
    argon2id: deps.argon2id,
    random: deps.random,
  });
  const newConfigText = serializeRepoConfig({
    ...created.config,
    createdAt: current.config.createdAt,
    ...(current.config.settings !== undefined
      ? { settings: current.config.settings }
      : {}),
  });
  const newKeyring = created.keyring;

  const blobShas = listing
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.sha);
  const contents = await readBlobs(adapter, blobShas, {
    sleep: sleepFor(deps),
    onProgress: (done, total) => onStep({ kind: "reading", done, total }),
  });

  const plan = await planRekey({
    listing,
    contents,
    oldKeyring,
    newKeyring,
    newConfigText,
    random: deps.random,
    onProgress: (done, total) => onStep({ kind: "encrypting", done, total }),
  });

  onStep({ kind: "verifying" });
  const verification = await verifyRekey({
    listing,
    contents,
    changes: plan.changes,
    oldKeyring,
    newKeyring,
    newConfigText,
  });
  if (!verification.ok) {
    console.error("Passphrase change check failed", verification.failure);
    fail({ kind: "verificationFailed" });
  }

  return {
    summary: plan.summary,
    parent: head,
    changes: plan.changes,
    keyring: newKeyring,
    expected: await expectedTree(listing, plan.changes),
    removeHistory:
      input.removeHistory === true && adapter.replaceHistory !== undefined,
  };
}

async function waitForBudget(
  deps: PassphraseChangeDeps,
  cost: number,
  onStep: (step: PassphraseChangeStep) => void,
): Promise<void> {
  const availableAt = deps.rateBudget.availableAt(cost);
  const wait = availableAt - deps.clock.now();
  if (wait <= 0) return;
  if (wait > MAX_BUDGET_WAIT_MS)
    fail({ kind: "rateBudget", retryAt: availableAt });
  onStep({ kind: "waitingForBudget", until: availableAt });
  await sleepFor(deps)(wait);
  const retryAt = deps.rateBudget.availableAt(cost);
  if (retryAt > deps.clock.now()) fail({ kind: "rateBudget", retryAt });
}

type Outcome =
  | { readonly kind: "landed"; readonly head: string }
  | { readonly kind: "notLanded" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "unknown" };

// The change landed exactly when main now holds a config that the new
// keyring verifies.
async function readOutcome(
  deps: PassphraseChangeDeps,
  prepared: PreparedPassphraseChange,
): Promise<Outcome> {
  try {
    const head = await deps.adapter.getHead();
    if (head === prepared.parent) return { kind: "unchanged" };
    const listing = await deps.adapter.listTree(head);
    const entry = listing.find(
      (item) => item.type === "blob" && item.path === REPO_CONFIG_PATH,
    );
    if (entry === undefined) return { kind: "notLanded" };
    const parsed = parseRepoConfig(await deps.adapter.readBlob(entry.sha));
    return parsed.kind === "valid" &&
      (await verifyKeyCheck(prepared.keyring, parsed.config))
      ? { kind: "landed", head }
      : { kind: "notLanded" };
  } catch {
    return { kind: "unknown" };
  }
}

async function checkLanded(
  deps: PassphraseChangeDeps,
  prepared: PreparedPassphraseChange,
  head: string,
): Promise<LandedCheck> {
  let listing;
  try {
    listing = await deps.adapter.listTree(head);
  } catch {
    return "unchecked";
  }
  if (sameTree(prepared.expected, listing)) return "matched";
  console.error("Passphrase change landed with unexpected files");
  return "mismatch";
}

// Runs only once the change landed, so a failure here leaves the passphrase
// changed with the old history in place.
async function replaceHistory(
  deps: PassphraseChangeDeps,
  head: string,
  onStep: (step: PassphraseChangeStep) => void,
): Promise<{ readonly history: HistoryOutcome; readonly head: string }> {
  const { adapter } = deps;
  try {
    if (adapter.replaceHistory === undefined) fail({ kind: "unavailable" });
    await waitForBudget(deps, REPLACE_HISTORY_COST, onStep);
    onStep({ kind: "removingHistory" });
    const result = await adapter.replaceHistory({
      head,
      message: encodeChangePassphraseMessage(),
    });
    if (result.kind === "ok") return { history: "removed", head: result.head };
    console.error("Removing the old history failed: main moved on");
  } catch (error) {
    console.error("Removing the old history failed", toFailure(error).kind);
  }
  return { history: "notRemoved", head };
}

async function landed(
  deps: PassphraseChangeDeps,
  prepared: PreparedPassphraseChange,
  head: string,
  onStep: (step: PassphraseChangeStep) => void,
): Promise<CommitPassphraseChangeResult> {
  const final = prepared.removeHistory
    ? await replaceHistory(deps, head, onStep)
    : { history: "kept" as const, head };
  return {
    ok: true,
    keyring: prepared.keyring,
    check: await checkLanded(deps, prepared, final.head),
    history: final.history,
  };
}

const UNSETTLED: CommitPassphraseChangeResult = {
  ok: false,
  failure: { kind: "outcomeUnknown" },
  unsettled: true,
};

/**
 * Commits a prepared change as one atomic commit. On success the old
 * engine must not be used again; on a failure that left main as it was it
 * is running again, and on an unsettled outcome it stays suspended.
 */
export async function commitPassphraseChange(
  deps: PassphraseChangeDeps,
  prepared: PreparedPassphraseChange,
  onStep: (step: PassphraseChangeStep) => void = () => {},
): Promise<CommitPassphraseChangeResult> {
  const { adapter } = deps;
  try {
    await waitForBudget(
      deps,
      adapter.commitCost(prepared.changes, { atomic: true }),
      onStep,
    );
  } catch (error) {
    abort(deps);
    return { ok: false, failure: toFailure(error) };
  }

  onStep({ kind: "uploading" });
  let result: CommitResult | null = null;
  let error: unknown = null;
  try {
    result = await adapter.commit({
      parent: prepared.parent,
      changes: prepared.changes,
      message: encodeChangePassphraseMessage(),
      atomic: true,
    });
  } catch (caught) {
    error = caught;
  }
  if (result?.kind === "ok") {
    return landed(deps, prepared, result.head, onStep);
  }

  const untouched = isForgeError(error) && error.mainUnchanged;
  if (!untouched) {
    // Some failures still mean the commit landed, e.g. a GitLab merge that
    // went through with an extra commit, or a lost response.
    onStep({ kind: "confirming" });
    const outcome = await readOutcome(deps, prepared);
    if (outcome.kind === "landed") {
      return landed(deps, prepared, outcome.head, onStep);
    }
    if (
      outcome.kind !== "notLanded" &&
      (isForgeError(error, "Network") || !isForgeError(error)) &&
      result === null
    ) {
      return UNSETTLED;
    }
  }

  abort(deps);
  if (result?.kind === "stale") {
    return { ok: false, failure: { kind: "changedElsewhere" } };
  }
  if (isForgeError(error, "Forbidden")) {
    const support = await adapter.atomicCommitSupport?.().catch(() => null);
    if (support?.kind === "needsSetup") {
      return {
        ok: false,
        failure: { kind: "needsSetup", canConfigure: support.canConfigure },
      };
    }
  }
  return { ok: false, failure: toFailure(error) };
}

/**
 * Looks again whether an unsettled change landed. Resumes the engine once
 * it is known not to have.
 */
export async function settlePassphraseChange(
  deps: PassphraseChangeDeps,
  prepared: PreparedPassphraseChange,
  onStep: (step: PassphraseChangeStep) => void = () => {},
): Promise<CommitPassphraseChangeResult> {
  const outcome = await readOutcome(deps, prepared);
  if (outcome.kind === "landed") {
    return landed(deps, prepared, outcome.head, onStep);
  }
  if (outcome.kind === "notLanded") {
    abort(deps);
    return { ok: false, failure: { kind: "changedElsewhere" } };
  }
  return UNSETTLED;
}

export interface PassphraseChange {
  /** Whether the forge can replace main's history after the change. */
  readonly canRemoveHistory: boolean;
  prepare(
    input: PassphraseChangeInput,
    onStep: (step: PassphraseChangeStep) => void,
  ): Promise<PrepareResult>;
  commit(
    prepared: PreparedPassphraseChange,
    onStep: (step: PassphraseChangeStep) => void,
  ): Promise<CommitPassphraseChangeResult>;
  settle(prepared: PreparedPassphraseChange): Promise<CommitPassphraseChangeResult>;
  cancel(): void;
  enableAtomicCommits(): Promise<AtomicCommitSupport>;
}

export function createPassphraseChange(
  deps: PassphraseChangeDeps,
): PassphraseChange {
  return {
    canRemoveHistory: deps.adapter.replaceHistory !== undefined,
    prepare: (input, onStep) => preparePassphraseChange(deps, input, onStep),
    commit: (prepared, onStep) =>
      commitPassphraseChange(deps, prepared, onStep),
    settle: (prepared) => settlePassphraseChange(deps, prepared),
    cancel: () => cancelPassphraseChange(deps),
    enableAtomicCommits: async () =>
      (await deps.adapter.enableAtomicCommits?.()) ?? { kind: "available" },
  };
}
