import type { Change, ChangeSet, NotePath } from "../changes/change";
import { isWithinFolder, notePathEquals, parentPath } from "../changes/change";
import { encodeChangeSet } from "../changes/encode-change-set";
import type { Keyring } from "../crypto/keyring";
import { decryptNote, NoteDecryptionError } from "../crypto/note-cipher";
import { isForgeError, type ForgeError } from "../forge/errors";
import type { ForgeAdapter, TreeEntry } from "../forge/forge-adapter";
import {
  mergeChangeSet,
  type MergeNotice,
  type NoteConflict,
} from "../merge/merge-change-set";
import { mergeText } from "../merge/merge-text";
import { validateName, type NameError } from "../tree/note-names";
import {
  buildNoteTree,
  findNode,
  type NoteNode,
  type NoteTree,
} from "../tree/note-tree";
import { createAutosave } from "./autosave";
import { retryDelayMs } from "./backoff";
import type { Clock } from "./clock";
import { createRateBudget, type RateBudget } from "./rate-budget";
import {
  computeSyncStates,
  hasConflictMarkers,
  type SyncStates,
} from "./sync-state";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  MAX_IMMEDIATE_STALE_RETRIES,
  SAVE_FIXED_REQUEST_COST,
} from "./tuning";
import {
  appendChange,
  buildWorkingTree,
  findWorkingNode,
  localContentAt,
  rebaseChanges,
  type WorkingFolder,
  type WorkingTree,
} from "./working-tree";

export type SyncError =
  | {
      readonly kind:
        | "unauthorized"
        | "forbidden"
        | "notFound"
        | "network"
        | "server"
        | "treeTruncated"
        | "undecryptable";
    }
  | { readonly kind: "rateLimited"; readonly retryAfterMs: number };

export interface SyncedState {
  readonly head: string;
  readonly listing: readonly TreeEntry[];
  readonly tree: NoteTree;
}

export type OpenNoteState =
  | { readonly kind: "loading"; readonly path: NotePath }
  | {
      readonly kind: "loaded";
      readonly path: NotePath;
      readonly blobSha: string | null;
      readonly content: string;
    }
  | { readonly kind: "missing"; readonly path: NotePath }
  | {
      readonly kind: "failed";
      readonly path: NotePath;
      readonly error: SyncError;
    };

export interface RefreshState {
  readonly inFlight: boolean;
  readonly lastError: SyncError | null;
  readonly lastCompletedAt: number | null;
}

export type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | {
      readonly kind: "waiting";
      readonly reason: "failed" | "rateBudget";
      readonly retryAt: number | null;
      readonly error: SyncError | null;
    }
  | { readonly kind: "stopped"; readonly error: SyncError };

export interface HeldConflict {
  readonly path: NotePath;
  readonly base: string;
  readonly mine: string;
  readonly theirs: string;
  readonly theirsBlobSha: string;
  readonly merged: string;
  readonly editing: string | null;
}

export type EngineNotice =
  | {
      readonly id: number;
      readonly kind: "merge";
      readonly notice: MergeNotice;
    }
  | { readonly id: number; readonly kind: "conflict"; readonly path: NotePath }
  | { readonly id: number; readonly kind: "dropped"; readonly change: Change };

type NoticeBody =
  | { readonly kind: "merge"; readonly notice: MergeNotice }
  | { readonly kind: "conflict"; readonly path: NotePath }
  | { readonly kind: "dropped"; readonly change: Change };

export interface SyncEngineState {
  readonly synced: SyncedState | null;
  readonly refresh: RefreshState;
  readonly openNote: OpenNoteState | null;
  readonly workingTree: WorkingTree | null;
  readonly pending: ChangeSet;
  readonly inFlight: ChangeSet;
  readonly save: SaveStatus;
  readonly conflicts: readonly HeldConflict[];
  readonly notices: readonly EngineNotice[];
  readonly syncStates: SyncStates;
}

export type StructureError =
  | { readonly kind: "invalidName"; readonly error: NameError }
  | { readonly kind: "notFound" }
  | { readonly kind: "conflicted" }
  | { readonly kind: "invalidTarget" };

export type StructureResult =
  | { readonly ok: true; readonly path: NotePath }
  | { readonly ok: false; readonly error: StructureError };

export type ConflictResolution = "keepMine" | "keepTheirs" | "editMerged";

export type FlushResult =
  | { readonly kind: "saved" }
  | { readonly kind: "unsaved"; readonly count: number };

export interface SyncEngine {
  getState(): SyncEngineState;
  subscribe(run: (state: SyncEngineState) => void): () => void;
  refresh(): Promise<void>;
  openNote(path: NotePath | null): Promise<void>;
  editNote(path: NotePath, content: string): void;
  createNote(parent: NotePath, name: string): StructureResult;
  createFolder(parent: NotePath, name: string): StructureResult;
  rename(path: NotePath, newName: string): StructureResult;
  move(path: NotePath, newParent: NotePath): StructureResult;
  delete(path: NotePath): StructureResult;
  flush(): Promise<FlushResult>;
  retryNow(): void;
  replaceAdapter(adapter: ForgeAdapter): void;
  resolveConflict(path: NotePath, resolution: ConflictResolution): void;
  dismissNotice(id: number): void;
  dispose(): void;
}

function mapForgeError(error: ForgeError): SyncError {
  switch (error.kind) {
    case "Unauthorized":
      return { kind: "unauthorized" };
    case "Forbidden":
      return { kind: "forbidden" };
    case "NotFound":
      return { kind: "notFound" };
    case "RateLimited":
      return { kind: "rateLimited", retryAfterMs: error.retryAfterMs ?? 0 };
    case "Network":
      return { kind: "network" };
    case "Server":
      return { kind: "server" };
    case "TreeTruncated":
      return { kind: "treeTruncated" };
  }
}

function isAtOrWithin(path: NotePath, folder: NotePath): boolean {
  return notePathEquals(path, folder) || isWithinFolder(path, folder);
}

function appendAll(changes: ChangeSet, more: ChangeSet): ChangeSet {
  let result = changes;
  for (const change of more) {
    result = appendChange(result, change);
  }
  return result;
}

function failure(error: StructureError): StructureResult {
  return { ok: false, error };
}

function childNames(folder: WorkingFolder, exclude?: string): string[] {
  return folder.children
    .map((child) => child.name)
    .filter((name) => name !== exclude);
}

function isFailedSave(save: SaveStatus): boolean {
  return (
    (save.kind === "waiting" && save.reason === "failed") ||
    save.kind === "stopped"
  );
}

function isStoppingError(error: ForgeError): boolean {
  return (
    error.kind === "Unauthorized" ||
    error.kind === "Forbidden" ||
    error.kind === "NotFound"
  );
}

function syncedNoteAt(
  synced: SyncedState,
  workingTree: WorkingTree,
  path: NotePath,
): NoteNode | undefined {
  const working = findWorkingNode(workingTree, path);
  if (working?.kind !== "note" || working.syncedPath === null) return undefined;
  const node = findNode(synced.tree, working.syncedPath);
  return node?.kind === "note" ? node : undefined;
}

const EMPTY_CHANGES: ChangeSet = [];
const EMPTY_CONFLICTS: readonly HeldConflict[] = [];

const INITIAL_STATE: SyncEngineState = {
  synced: null,
  refresh: { inFlight: false, lastError: null, lastCompletedAt: null },
  openNote: null,
  workingTree: null,
  pending: EMPTY_CHANGES,
  inFlight: EMPTY_CHANGES,
  save: { kind: "idle" },
  conflicts: EMPTY_CONFLICTS,
  notices: [],
  syncStates: computeSyncStates({
    pending: EMPTY_CHANGES,
    inFlight: EMPTY_CHANGES,
    failed: false,
    conflicts: [],
  }),
};

export function createSyncEngine(options: {
  readonly adapter: ForgeAdapter;
  readonly keyring: Keyring;
  readonly clock: Clock;
  readonly rateBudget?: RateBudget;
}): SyncEngine {
  const { keyring, clock } = options;
  let adapter = options.adapter;
  const rateBudget = options.rateBudget ?? createRateBudget(clock);

  let state: SyncEngineState = INITIAL_STATE;
  const subscribers = new Set<(state: SyncEngineState) => void>();
  let disposed = false;
  let refreshInFlight: Promise<void> | null = null;
  // Bumped on every openNote() call (and whenever the open note is replaced
  // synchronously) so a result from an earlier load can be told apart from
  // the latest request and discarded if it is stale.
  let openNoteEpoch = 0;
  let nextNoticeId = 1;

  let saveLoop: Promise<void> | null = null;
  let saveAgain = false;
  // A head whose commit already holds `inFlight` but whose tree could not be
  // loaded yet; the next save loads it instead of committing again.
  let committedHead: string | null = null;
  let consecutiveFailures = 0;
  let retryTimer: unknown = undefined;

  const autosave = createAutosave({
    clock,
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    maxWaitMs: AUTOSAVE_MAX_WAIT_MS,
    save: () => {
      void triggerSave();
    },
  });

  function derive(
    previous: SyncEngineState,
    next: SyncEngineState,
  ): SyncEngineState {
    let result = next;
    if (
      next.synced !== previous.synced ||
      next.pending !== previous.pending ||
      next.inFlight !== previous.inFlight
    ) {
      result = {
        ...result,
        workingTree:
          next.synced === null
            ? null
            : buildWorkingTree(next.synced.tree, [
                ...next.inFlight,
                ...next.pending,
              ]),
      };
    }
    if (
      next.pending !== previous.pending ||
      next.inFlight !== previous.inFlight ||
      next.save !== previous.save ||
      next.conflicts !== previous.conflicts
    ) {
      result = {
        ...result,
        syncStates: computeSyncStates({
          pending: next.pending,
          inFlight: next.inFlight,
          failed: isFailedSave(next.save),
          conflicts: next.conflicts.map((conflict) => conflict.path),
        }),
      };
    }
    return result;
  }

  function update(
    updater: (current: SyncEngineState) => SyncEngineState,
  ): void {
    if (disposed) return;
    const previous = state;
    state = derive(previous, updater(previous));
    for (const run of subscribers) {
      run(state);
    }
  }

  function notices(
    current: readonly EngineNotice[],
    bodies: readonly NoticeBody[],
  ): readonly EngineNotice[] {
    if (bodies.length === 0) return current;
    return [
      ...current,
      ...bodies.map(
        (body) => ({ ...body, id: nextNoticeId++ }) as EngineNotice,
      ),
    ];
  }

  function toSyncError(error: unknown): SyncError {
    if (error instanceof NoteDecryptionError) {
      return { kind: "undecryptable" };
    }
    if (isForgeError(error)) {
      return mapForgeError(error);
    }
    throw error;
  }

  function conflictAt(path: NotePath): HeldConflict | undefined {
    return state.conflicts.find((conflict) =>
      notePathEquals(conflict.path, path),
    );
  }

  async function readNoteText(tree: NoteTree, path: NotePath): Promise<string> {
    const node = findNode(tree, path);
    if (node?.kind !== "note") {
      throw new Error("No note at the requested path");
    }
    return decryptNote(keyring, await adapter.readBlob(node.blobSha));
  }

  async function loadSynced(head: string): Promise<SyncedState> {
    const listing = await adapter.listTree(head);
    const tree = await buildNoteTree(listing, keyring);
    return { head, listing, tree };
  }

  // ---- Open note ----

  type NoteResolution =
    | { readonly kind: "local"; readonly content: string }
    | { readonly kind: "blob"; readonly blobSha: string }
    | { readonly kind: "missing" };

  function resolveWorkingNote(path: NotePath): NoteResolution {
    const { synced, workingTree } = state;
    if (synced === null || workingTree === null) return { kind: "missing" };
    const node = findWorkingNode(workingTree, path);
    if (node?.kind !== "note") return { kind: "missing" };

    const conflict = conflictAt(path);
    if (conflict !== undefined && conflict.editing !== null) {
      return { kind: "local", content: conflict.editing };
    }
    if (conflict === undefined) {
      const local = localContentAt([...state.inFlight, ...state.pending], path);
      if (local !== undefined) return { kind: "local", content: local };
    }

    const syncedNode = syncedNoteAt(synced, workingTree, path);
    if (syncedNode === undefined) return { kind: "missing" };
    return { kind: "blob", blobSha: syncedNode.blobSha };
  }

  function applyOpenNoteResult(epoch: number, next: OpenNoteState): void {
    if (epoch !== openNoteEpoch) return;
    update((current) => ({ ...current, openNote: next }));
  }

  function replaceOpenNote(next: OpenNoteState | null): void {
    openNoteEpoch++;
    update((current) => ({ ...current, openNote: next }));
  }

  function showLocalContent(path: NotePath, content: string): void {
    const current = state.openNote;
    if (current === null || !notePathEquals(current.path, path)) return;
    if (
      current.kind === "loaded" &&
      current.blobSha === null &&
      current.content === content
    ) {
      return;
    }
    replaceOpenNote({
      kind: "loaded",
      path: current.path,
      blobSha: null,
      content,
    });
  }

  async function fetchAndApplyNote(
    path: NotePath,
    blobSha: string,
    epoch: number,
  ): Promise<void> {
    try {
      const stored = await adapter.readBlob(blobSha);
      const content = await decryptNote(keyring, stored);
      applyOpenNoteResult(epoch, { kind: "loaded", path, blobSha, content });
    } catch (error) {
      applyOpenNoteResult(epoch, {
        kind: "failed",
        path,
        error: toSyncError(error),
      });
    }
  }

  async function reresolveOpenNote(): Promise<void> {
    const current = state.openNote;
    if (current === null) return;
    const path = current.path;
    const epoch = openNoteEpoch;
    const resolution = resolveWorkingNote(path);

    switch (resolution.kind) {
      case "missing":
        if (current.kind !== "missing") {
          applyOpenNoteResult(epoch, { kind: "missing", path });
        }
        return;
      case "local":
        if (
          current.kind === "loaded" &&
          current.blobSha === null &&
          current.content === resolution.content
        ) {
          return;
        }
        applyOpenNoteResult(epoch, {
          kind: "loaded",
          path,
          blobSha: null,
          content: resolution.content,
        });
        return;
      case "blob":
        if (
          current.kind === "loaded" &&
          current.blobSha === resolution.blobSha
        ) {
          return;
        }
        // Keep showing the previously loaded content while the new blob
        // loads; any other prior state switches to loading.
        if (current.kind !== "loaded") {
          applyOpenNoteResult(epoch, { kind: "loading", path });
        }
        await fetchAndApplyNote(path, resolution.blobSha, epoch);
        return;
    }
  }

  function openNote(path: NotePath | null): Promise<void> {
    if (disposed) return Promise.resolve();

    const previous = state.openNote;
    const switching =
      previous !== null &&
      (path === null || !notePathEquals(previous.path, path));

    const epoch = ++openNoteEpoch;
    let loading: Promise<void> = Promise.resolve();

    if (path === null) {
      update((current) => ({ ...current, openNote: null }));
    } else {
      const resolution = resolveWorkingNote(path);
      switch (resolution.kind) {
        case "missing":
          update((current) => ({
            ...current,
            openNote: { kind: "missing", path },
          }));
          break;
        case "local":
          update((current) => ({
            ...current,
            openNote: {
              kind: "loaded",
              path,
              blobSha: null,
              content: resolution.content,
            },
          }));
          break;
        case "blob":
          update((current) => ({
            ...current,
            openNote: { kind: "loading", path },
          }));
          loading = fetchAndApplyNote(path, resolution.blobSha, epoch);
          break;
      }
    }

    if (switching && state.pending.length > 0) {
      autosave.saveNow();
    }
    return loading;
  }

  function followRelocation(from: NotePath, to: NotePath): void {
    const current = state.openNote;
    if (current === null || !isAtOrWithin(current.path, from)) return;
    const path = [...to, ...current.path.slice(from.length)];
    replaceOpenNote({ ...current, path });
    if (current.kind === "loading") void reresolveOpenNote();
  }

  function followDelete(deleted: NotePath): void {
    const current = state.openNote;
    if (current === null || !isAtOrWithin(current.path, deleted)) return;
    replaceOpenNote({ kind: "missing", path: current.path });
  }

  // ---- Held conflicts ----

  function appendRebased(change: Change): void {
    update((current) => {
      if (current.synced === null) return current;
      const rebased = rebaseChanges(
        current.synced.tree,
        [...current.inFlight, ...current.pending],
        [change],
      );
      return {
        ...current,
        pending: appendAll(current.pending, rebased.changes),
        notices: notices(
          current.notices,
          rebased.dropped.map((dropped) => ({
            kind: "dropped" as const,
            change: dropped,
          })),
        ),
      };
    });
  }

  // Re-merges every held conflict whose remote version changed since it was
  // taken, after `synced` has advanced.
  async function recheckConflicts(): Promise<void> {
    const { synced, workingTree } = state;
    if (synced === null || workingTree === null) return;

    const newTheirs = new Map<
      HeldConflict,
      { blobSha: string; text: string } | null
    >();
    for (const conflict of state.conflicts) {
      const node = syncedNoteAt(synced, workingTree, conflict.path);
      if (node === undefined) {
        newTheirs.set(conflict, null);
      } else if (node.blobSha !== conflict.theirsBlobSha) {
        const text = await decryptNote(
          keyring,
          await adapter.readBlob(node.blobSha),
        );
        newTheirs.set(conflict, { blobSha: node.blobSha, text });
      }
    }
    if (newTheirs.size === 0) return;

    let needsSave = false;
    const paths = new Set<string>();
    for (const [conflict, theirs] of newTheirs) {
      // The conflict may have been resolved while the new version loaded.
      if (!state.conflicts.includes(conflict)) continue;
      const local = conflict.editing ?? conflict.mine;
      const without = state.conflicts.filter((held) => held !== conflict);

      if (theirs === null) {
        update((current) => ({
          ...current,
          conflicts: without,
          notices: notices(current.notices, [
            {
              kind: "merge",
              notice: { kind: "edit-restored", path: conflict.path },
            },
          ]),
        }));
        appendRebased({
          kind: "create-note",
          path: conflict.path,
          content: hasConflictMarkers(local) ? conflict.mine : local,
        });
        needsSave = true;
      } else {
        const result = mergeText(conflict.base, local, theirs.text);
        if (result.kind === "clean" && !hasConflictMarkers(result.text)) {
          update((current) => ({
            ...current,
            conflicts: without,
            pending: appendChange(current.pending, {
              kind: "update-note",
              path: conflict.path,
              content: result.text,
            }),
          }));
          needsSave = true;
        } else {
          const replaced: HeldConflict = {
            ...conflict,
            theirs: theirs.text,
            theirsBlobSha: theirs.blobSha,
            merged: result.text,
          };
          update((current) => ({
            ...current,
            conflicts: current.conflicts.map((held) =>
              held === conflict ? replaced : held,
            ),
            notices: notices(current.notices, [
              { kind: "conflict", path: conflict.path },
            ]),
          }));
        }
      }
      paths.add(JSON.stringify(conflict.path));
    }

    const open = state.openNote;
    if (open !== null && paths.has(JSON.stringify(open.path))) {
      void reresolveOpenNote();
    }
    if (needsSave) autosave.saveNow();
  }

  // ---- Save loop ----

  function cancelRetry(): void {
    if (retryTimer !== undefined) {
      clock.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function scheduleRetry(at: number): void {
    cancelRetry();
    retryTimer = clock.setTimeout(
      () => {
        retryTimer = undefined;
        void triggerSave(true);
      },
      Math.max(0, at - clock.now()),
    );
  }

  // A stop reported by a refresh while a save runs must survive the save's
  // own outcome.
  function unlessStopped(current: SyncEngineState, save: SaveStatus): SaveStatus {
    return current.save.kind === "stopped" ? current.save : save;
  }

  function saveSucceeded(): void {
    consecutiveFailures = 0;
    update((current) => ({
      ...current,
      save: unlessStopped(current, { kind: "idle" }),
    }));
  }

  // Waits (back-off or rate budget) are only ended by their own timer,
  // retryNow(), flush() or replaceAdapter(); other triggers are ignored.
  function triggerSave(endWait = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (saveLoop !== null) {
      saveAgain = true;
      return saveLoop;
    }
    if (state.save.kind === "stopped" || state.synced === null) {
      return Promise.resolve();
    }
    if (state.save.kind === "waiting" && !endWait) {
      return Promise.resolve();
    }
    cancelRetry();
    if (state.pending.length === 0 && committedHead === null) {
      if (state.save.kind === "waiting") {
        update((current) => ({ ...current, save: { kind: "idle" } }));
      }
      return Promise.resolve();
    }
    const loop = runSaves().finally(() => {
      if (saveLoop === loop) saveLoop = null;
    });
    saveLoop = loop;
    return loop;
  }

  async function runSaves(): Promise<void> {
    for (;;) {
      saveAgain = false;
      await runOneSave();
      if (disposed || !saveAgain || state.save.kind !== "idle") return;
      if (state.pending.length === 0) return;
    }
  }

  async function adoptCommittedHead(head: string): Promise<void> {
    const synced = await loadSynced(head);
    committedHead = null;
    update((current) => ({ ...current, synced, inFlight: EMPTY_CHANGES }));
    await recheckConflicts();
    await reresolveOpenNote();
  }

  async function runOneSave(): Promise<void> {
    update((current) => ({ ...current, save: { kind: "saving" } }));

    try {
      if (committedHead !== null) {
        await adoptCommittedHead(committedHead);
      }
      if (state.pending.length === 0) {
        saveSucceeded();
        return;
      }

      update((current) => ({
        ...current,
        inFlight: current.pending,
        pending: EMPTY_CHANGES,
      }));

      let staleCount = 0;
      for (;;) {
        const attemptSynced = state.synced!;
        const encoded = await encodeChangeSet({
          listing: attemptSynced.listing,
          changeSet: state.inFlight,
          keyring,
        });
        const cost =
          encoded.changes.filter((change) => change.kind === "upsert-text")
            .length + SAVE_FIXED_REQUEST_COST;
        const availableAt = rateBudget.availableAt(cost);
        if (availableAt > clock.now()) {
          waitForBudget(availableAt);
          return;
        }
        const result = await adapter.commit({
          parent: attemptSynced.head,
          changes: encoded.changes,
          message: encoded.message,
        });

        if (result.kind === "ok") {
          committedHead = result.head;
          await adoptCommittedHead(result.head);
          saveSucceeded();
          return;
        }

        staleCount++;
        if (staleCount >= MAX_IMMEDIATE_STALE_RETRIES) {
          failAttempt({ kind: "server" });
          return;
        }

        const committed = await mergeWithRemote(attemptSynced);
        if (!committed) {
          update((current) => ({ ...current, inFlight: EMPTY_CHANGES }));
          saveSucceeded();
          return;
        }
      }
    } catch (error) {
      if (isForgeError(error)) {
        const mapped = mapForgeError(error);
        if (isStoppingError(error)) {
          stopSaving(mapped);
          returnUncommitted();
        } else {
          failAttempt(mapped);
        }
        return;
      }
      console.error("Save failed", error);
      failAttempt({ kind: "server" });
    }
  }

  // Changes already committed stay in flight so a retry only loads their
  // tree and never commits them twice.
  function returnUncommitted(): void {
    if (committedHead !== null) return;
    update((current) => ({
      ...current,
      pending: appendAll(current.inFlight, current.pending),
      inFlight: EMPTY_CHANGES,
    }));
  }

  function stopSaving(error: SyncError): void {
    cancelRetry();
    update((current) => ({ ...current, save: { kind: "stopped", error } }));
  }

  function failAttempt(error: SyncError): void {
    consecutiveFailures++;
    const retryAt =
      clock.now() +
      retryDelayMs(error, consecutiveFailures);
    returnUncommitted();
    update((current) => ({
      ...current,
      save: unlessStopped(current, {
        kind: "waiting",
        reason: "failed",
        retryAt,
        error,
      }),
    }));
    if (state.save.kind === "waiting") scheduleRetry(retryAt);
  }

  function waitForBudget(retryAt: number): void {
    returnUncommitted();
    update((current) => ({
      ...current,
      save: unlessStopped(current, {
        kind: "waiting",
        reason: "rateBudget",
        retryAt,
        error: null,
      }),
    }));
    if (state.save.kind === "waiting") scheduleRetry(retryAt);
  }

  function touchesPath(change: Change, path: NotePath): boolean {
    switch (change.kind) {
      case "create-note":
      case "update-note":
        return notePathEquals(change.path, path);
      case "create-folder":
        return false;
      case "delete-note":
      case "delete-folder":
        return isAtOrWithin(path, change.path);
      case "rename-note":
      case "rename-folder":
        return isAtOrWithin(path, change.from) || isAtOrWithin(path, change.to);
    }
  }

  // Merges the in-flight change set with the remote head after a stale
  // commit. Returns whether the merged change set still needs committing.
  async function mergeWithRemote(base: SyncedState): Promise<boolean> {
    const head = await adapter.getHead();
    const remote = await loadSynced(head);

    update((current) => ({
      ...current,
      inFlight: appendAll(current.inFlight, current.pending),
      pending: EMPTY_CHANGES,
    }));

    const merged = await mergeChangeSet({
      base: base.tree,
      remote: remote.tree,
      changeSet: state.inFlight,
      readBaseContent: (path) => readNoteText(base.tree, path),
      readRemoteContent: (path) => readNoteText(remote.tree, path),
    });

    const mergedTree = buildWorkingTree(remote.tree, merged.changeSet);
    const newConflicts = merged.conflicts.map((conflict) =>
      toHeldConflict(conflict, remote, mergedTree),
    );

    update((current) => {
      const bodies: NoticeBody[] = merged.notices.map((notice) => ({
        kind: "merge",
        notice,
      }));

      // Changes made while the merge ran must not bypass a new conflict:
      // edits of a conflicted note become its local version, structure
      // changes around it are dropped.
      const conflicts = newConflicts.slice();
      const extraPending: Change[] = [];
      const toRebase: Change[] = [];
      for (const change of current.pending) {
        const index = conflicts.findIndex((conflict) =>
          touchesPath(change, conflict.path),
        );
        if (index === -1) {
          toRebase.push(change);
        } else if (
          change.kind === "update-note" ||
          change.kind === "create-note"
        ) {
          const conflict = conflicts[index];
          const result = mergeText(
            conflict.base,
            change.content,
            conflict.theirs,
          );
          if (result.kind === "clean") {
            conflicts.splice(index, 1);
            extraPending.push({
              kind: "update-note",
              path: conflict.path,
              content: result.text,
            });
          } else {
            conflicts[index] = {
              ...conflict,
              mine: change.content,
              merged: result.text,
            };
          }
        } else {
          bodies.push({ kind: "dropped", change });
        }
      }

      const rebased = rebaseChanges(remote.tree, merged.changeSet, toRebase);
      for (const dropped of rebased.dropped) {
        bodies.push({ kind: "dropped", change: dropped });
      }
      for (const conflict of conflicts) {
        bodies.push({ kind: "conflict", path: conflict.path });
      }

      return {
        ...current,
        synced: remote,
        inFlight: merged.changeSet,
        pending: appendAll(rebased.changes, extraPending),
        conflicts:
          conflicts.length === 0
            ? current.conflicts
            : [...current.conflicts, ...conflicts],
        notices: notices(current.notices, bodies),
      };
    });

    await recheckConflicts();
    await reresolveOpenNote();

    return state.inFlight.length > 0;
  }

  function toHeldConflict(
    conflict: NoteConflict,
    remote: SyncedState,
    mergedTree: WorkingTree,
  ): HeldConflict {
    const node = syncedNoteAt(remote, mergedTree, conflict.path);
    return {
      path: conflict.path,
      base: conflict.base,
      mine: conflict.mine,
      theirs: conflict.theirs,
      theirsBlobSha: node?.blobSha ?? "",
      merged: conflict.merged,
      editing: null,
    };
  }

  // ---- Refresh ----

  function hasLocalWork(): boolean {
    return (
      state.pending.length > 0 ||
      state.inFlight.length > 0 ||
      committedHead !== null
    );
  }

  async function doRefresh(): Promise<void> {
    update((current) => ({
      ...current,
      refresh: { ...current.refresh, inFlight: true },
    }));

    try {
      const head = await adapter.getHead();

      if (saveLoop === null) {
        if (hasLocalWork()) {
          if (head !== state.synced?.head) void triggerSave();
        } else if (state.synced === null || state.synced.head !== head) {
          const synced = await loadSynced(head);
          // A save or local change started while the tree loaded is merged
          // by the save instead.
          if (saveLoop === null && !hasLocalWork()) {
            update((current) => ({ ...current, synced }));
            await recheckConflicts();
          } else if (saveLoop === null) {
            void triggerSave();
          }
        }
        await reresolveOpenNote();
      }

      update((current) => ({
        ...current,
        refresh: {
          inFlight: false,
          lastError: null,
          lastCompletedAt: clock.now(),
        },
      }));
    } catch (error) {
      if (isForgeError(error)) {
        const mapped = mapForgeError(error);
        update((current) => ({
          ...current,
          refresh: {
            inFlight: false,
            lastError: mapped,
            lastCompletedAt: current.refresh.lastCompletedAt,
          },
        }));
        if (isStoppingError(error)) stopSaving(mapped);
        return;
      }
      update((current) => ({
        ...current,
        refresh: { ...current.refresh, inFlight: false },
      }));
      throw error;
    }
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (refreshInFlight !== null) return refreshInFlight;

    const promise = doRefresh().finally(() => {
      if (refreshInFlight === promise) {
        refreshInFlight = null;
      }
    });
    refreshInFlight = promise;
    return promise;
  }

  // ---- Commands ----

  function editNote(path: NotePath, content: string): void {
    if (disposed || state.workingTree === null) return;
    const node = findWorkingNode(state.workingTree, path);
    if (node?.kind !== "note") return;

    const conflict = conflictAt(path);
    if (conflict !== undefined) {
      if (conflict.editing === null) return;
      if (hasConflictMarkers(content)) {
        update((current) => ({
          ...current,
          conflicts: current.conflicts.map((held) =>
            held === conflict ? { ...held, editing: content } : held,
          ),
        }));
        showLocalContent(path, content);
        return;
      }
      update((current) => ({
        ...current,
        conflicts: current.conflicts.filter((held) => held !== conflict),
      }));
    }

    update((current) => ({
      ...current,
      pending: appendChange(current.pending, {
        kind: "update-note",
        path,
        content,
      }),
    }));
    showLocalContent(path, content);
    autosave.noteEdited();
  }

  function applyStructureChange(change: Change): void {
    update((current) => ({
      ...current,
      pending: appendChange(current.pending, change),
    }));
    switch (change.kind) {
      case "rename-note":
      case "rename-folder":
        followRelocation(change.from, change.to);
        break;
      case "delete-note":
      case "delete-folder":
        followDelete(change.path);
        break;
      default:
        break;
    }
    autosave.saveNow();
  }

  function isConflictedWithin(path: NotePath): boolean {
    return state.conflicts.some((conflict) =>
      isAtOrWithin(conflict.path, path),
    );
  }

  function workingFolderAt(path: NotePath): WorkingFolder | undefined {
    if (state.workingTree === null) return undefined;
    const node = findWorkingNode(state.workingTree, path);
    return node?.kind === "folder" ? node : undefined;
  }

  function create(
    kind: "create-note" | "create-folder",
    parent: NotePath,
    name: string,
  ): StructureResult {
    if (disposed) return failure({ kind: "notFound" });
    const folder = workingFolderAt(parent);
    if (folder === undefined) return failure({ kind: "notFound" });
    const validation = validateName(name, childNames(folder));
    if (!validation.ok) {
      return failure({ kind: "invalidName", error: validation.error });
    }
    const path = [...parent, validation.name];
    applyStructureChange(
      kind === "create-note"
        ? { kind, path, content: "" }
        : { kind: "create-folder", path },
    );
    return { ok: true, path };
  }

  function rename(path: NotePath, newName: string): StructureResult {
    if (disposed || state.workingTree === null || path.length === 0) {
      return failure({ kind: "notFound" });
    }
    const node = findWorkingNode(state.workingTree, path);
    if (node === undefined) return failure({ kind: "notFound" });
    if (isConflictedWithin(path)) return failure({ kind: "conflicted" });

    const parent = parentPath(path);
    const folder = workingFolderAt(parent)!;
    const validation = validateName(newName, childNames(folder, node.name));
    if (!validation.ok) {
      return failure({ kind: "invalidName", error: validation.error });
    }
    const to = [...parent, validation.name];
    if (validation.name === node.name) return { ok: true, path: to };

    applyStructureChange({
      kind: node.kind === "note" ? "rename-note" : "rename-folder",
      from: path,
      to,
    });
    return { ok: true, path: to };
  }

  function move(path: NotePath, newParent: NotePath): StructureResult {
    if (disposed || state.workingTree === null || path.length === 0) {
      return failure({ kind: "notFound" });
    }
    const node = findWorkingNode(state.workingTree, path);
    if (node === undefined) return failure({ kind: "notFound" });
    if (isConflictedWithin(path)) return failure({ kind: "conflicted" });
    if (
      notePathEquals(newParent, parentPath(path)) ||
      (node.kind === "folder" && isAtOrWithin(newParent, path))
    ) {
      return failure({ kind: "invalidTarget" });
    }

    const target = workingFolderAt(newParent);
    if (target === undefined) return failure({ kind: "notFound" });
    const validation = validateName(node.name, childNames(target));
    if (!validation.ok) {
      return failure({ kind: "invalidName", error: validation.error });
    }
    const to = [...newParent, node.name];
    applyStructureChange({
      kind: node.kind === "note" ? "rename-note" : "rename-folder",
      from: path,
      to,
    });
    return { ok: true, path: to };
  }

  function deleteItem(path: NotePath): StructureResult {
    if (disposed || state.workingTree === null || path.length === 0) {
      return failure({ kind: "notFound" });
    }
    const node = findWorkingNode(state.workingTree, path);
    if (node === undefined) return failure({ kind: "notFound" });
    if (isConflictedWithin(path)) return failure({ kind: "conflicted" });
    applyStructureChange({
      kind: node.kind === "note" ? "delete-note" : "delete-folder",
      path,
    });
    return { ok: true, path };
  }

  function flushResult(): FlushResult {
    const count = state.syncStates.unsavedCount;
    return count === 0 ? { kind: "saved" } : { kind: "unsaved", count };
  }

  async function flush(): Promise<FlushResult> {
    autosave.cancel();
    const save = state.save;
    if (
      save.kind === "stopped" ||
      (save.kind === "waiting" && save.reason === "rateBudget")
    ) {
      return flushResult();
    }
    await triggerSave(true);
    return flushResult();
  }

  function retryNow(): void {
    const save = state.save;
    if (save.kind === "waiting" && save.reason === "failed") {
      void triggerSave(true);
    }
  }

  function replaceAdapter(next: ForgeAdapter): void {
    if (disposed) return;
    adapter = next;
    consecutiveFailures = 0;
    if (state.save.kind === "stopped") {
      update((current) => ({ ...current, save: { kind: "idle" } }));
    }
    void refresh().then(() => triggerSave());
  }

  function resolveConflict(
    path: NotePath,
    resolution: ConflictResolution,
  ): void {
    const conflict = conflictAt(path);
    if (disposed || conflict === undefined) return;

    switch (resolution) {
      case "keepMine":
        update((current) => ({
          ...current,
          conflicts: current.conflicts.filter((held) => held !== conflict),
        }));
        appendRebased({ kind: "update-note", path, content: conflict.mine });
        void reresolveOpenNote();
        autosave.saveNow();
        return;
      case "keepTheirs":
        update((current) => ({
          ...current,
          conflicts: current.conflicts.filter((held) => held !== conflict),
        }));
        void reresolveOpenNote();
        return;
      case "editMerged":
        update((current) => ({
          ...current,
          conflicts: current.conflicts.map((held) =>
            held === conflict ? { ...held, editing: conflict.merged } : held,
          ),
        }));
        showLocalContent(path, conflict.merged);
        return;
    }
  }

  function dismissNotice(id: number): void {
    update((current) => ({
      ...current,
      notices: current.notices.filter((notice) => notice.id !== id),
    }));
  }

  function dispose(): void {
    disposed = true;
    autosave.dispose();
    cancelRetry();
    subscribers.clear();
  }

  function subscribe(run: (state: SyncEngineState) => void): () => void {
    run(state);
    if (disposed) return () => {};
    subscribers.add(run);
    return () => {
      subscribers.delete(run);
    };
  }

  return {
    getState: () => state,
    subscribe,
    refresh,
    openNote,
    editNote,
    createNote: (parent, name) => create("create-note", parent, name),
    createFolder: (parent, name) => create("create-folder", parent, name),
    rename,
    move,
    delete: deleteItem,
    flush,
    retryNow,
    replaceAdapter,
    resolveConflict,
    dismissNotice,
    dispose,
  };
}
