import type { Change, ChangeSet, NotePath } from "../changes/change";
import { isAtOrWithin, notePathEquals, parentPath } from "../changes/change";
import { encodeChangeSet } from "../changes/encode-change-set";
import { verifyKeyCheck, type Keyring } from "../crypto/keyring";
import { decryptNote, NoteDecryptionError } from "../crypto/note-cipher";
import {
  findConfigEntry,
  parseRepoConfig,
  type RepoConfig,
} from "../crypto/repo-config";
import { FOLDER_MARKER } from "../format/v1";
import {
  applySettingsEdits,
  rawSettingsOf,
  resolveSettings,
  SETTINGS_SCHEMA,
  type RawSettings,
  type Settings,
  type SettingsEdits,
} from "../settings/settings";
import { isForgeError, type ForgeError } from "../forge/errors";
import type {
  AtomicCommitSupport,
  ForgeAdapter,
  KeyBoundFile,
  TreeEntry,
} from "../forge/forge-adapter";
import {
  mergeChangeSet,
  type MergeNotice,
  type NoteConflict,
} from "../merge/merge-change-set";
import { mergeText } from "../merge/merge-text";
import {
  decryptOrderIndex,
  EMPTY_ORDER,
  findOrderEntry,
  folderKey,
  type OrderIndex,
} from "../order/order-index";
import {
  decryptTagIndex,
  EMPTY_TAGS,
  findTagEntry,
  type TagIndex,
} from "../tags/tag-index";
import {
  decryptShareIndex,
  EMPTY_SHARES,
  findSharesFile,
  type ShareEntry,
  type ShareIndex,
} from "../share/share-index";
import type { ColorTag } from "../tags/color-tag";
import { insertionIndex, placementPositions } from "../order/placement";
import { isExpired, selectExpired, type PurgeCaps } from "../trash/expiry";
import { createTrashEntryId } from "../trash/trash-entry-id";
import { buildTrashIndex, type TrashEntry } from "../trash/trash-index";
import { validateName, type NameError } from "../tree/note-names";
import {
  buildNoteTree,
  countUndecryptableFiles,
  findNode,
  type FolderNode,
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
  removeConflictMarkerLines,
  type SyncStates,
} from "./sync-state";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  MAX_IMMEDIATE_STALE_RETRIES,
  TRASH_PURGE_HEADROOM,
} from "./tuning";
import {
  findTrashItem,
  findWorkingTrashEntry,
  visibleTrashEntries,
  type ReadableWorkingTrashEntry,
  type WorkingTrashEntry,
} from "./working-trash";
import {
  appendChange,
  buildWorkingState,
  buildWorkingTree,
  findWorkingFolder,
  findWorkingNode,
  localContentAt,
  rebaseChanges,
  type WorkingFolder,
  type WorkingNode,
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
        | "undecryptable"
        | "keyChanged";
    }
  | { readonly kind: "rateLimited"; readonly retryAfterMs: number };

interface SyncedState {
  readonly head: string;
  readonly listing: readonly TreeEntry[];
  readonly tree: NoteTree;
  readonly trash: readonly TrashEntry[];
  readonly order: OrderIndex;
  readonly tags: TagIndex;
  readonly shares: ShareIndex;
  readonly config: RepoConfig;
  readonly settings: Settings;
  /** Files left out of `tree` because their names don't decrypt. */
  readonly undecryptableFiles: number;
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

interface RefreshState {
  readonly inFlight: boolean;
  readonly lastError: SyncError | null;
  readonly lastCompletedAt: number | null;
}

type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | {
      readonly kind: "waiting";
      readonly reason: "failed" | "rateBudget";
      readonly retryAt: number | null;
      readonly error: SyncError | null;
    };

export interface HeldConflict {
  readonly path: NotePath;
  readonly base: string;
  readonly mine: string;
  readonly theirs: string;
  readonly theirsBlobSha: string;
  readonly merged: string;
  readonly editing: string | null;
}

type NoticeBody =
  | { readonly kind: "merge"; readonly notice: MergeNotice }
  | { readonly kind: "conflict"; readonly path: NotePath }
  | { readonly kind: "edited-merge-restored"; readonly path: NotePath }
  | { readonly kind: "dropped"; readonly change: Change };

export type EngineNotice = NoticeBody & { readonly id: number };

export interface SyncEngineState {
  readonly synced: SyncedState | null;
  readonly refresh: RefreshState;
  readonly openNote: OpenNoteState | null;
  readonly workingTree: WorkingTree | null;
  /** Every stored entry, including expired and undecryptable ones. */
  readonly trash: readonly WorkingTrashEntry[] | null;
  /** What the user sees: readable entries not yet past retention. */
  readonly visibleTrash: readonly ReadableWorkingTrashEntry[] | null;
  /** The share index with every unsaved share change applied. */
  readonly shares: ShareIndex | null;
  readonly pending: ChangeSet;
  readonly inFlight: ChangeSet;
  /** Stored settings with every unsaved settings edit applied. */
  readonly rawSettings: RawSettings;
  readonly settings: Settings;
  readonly save: SaveStatus;
  readonly conflicts: readonly HeldConflict[];
  readonly notices: readonly EngineNotice[];
  readonly syncStates: SyncStates;
  /** Set once syncing stopped for good; nothing is written after that. */
  readonly stopped: SyncError | null;
  /** Imported changes are queued or being committed. */
  readonly importing: boolean;
  /**
   * Set when the import commit was refused because the forge needs a
   * setting change for atomic commits; saving waits until that is resolved.
   */
  readonly atomicBlocked: { readonly canConfigure: boolean } | null;
  /** Saving, refreshing and every change are paused until `resume()`. */
  readonly suspended: boolean;
}

export type StructureError =
  | { readonly kind: "invalidName"; readonly error: NameError }
  | { readonly kind: "notFound" }
  | { readonly kind: "conflicted" }
  | { readonly kind: "invalidTarget" }
  /** The stored order couldn't be read, so positions can't be changed. */
  | { readonly kind: "orderUnavailable" }
  /** The stored tags couldn't be read, so color tags can't be changed. */
  | { readonly kind: "tagsUnavailable" }
  /** The stored share index couldn't be read, so shares can't be changed. */
  | { readonly kind: "sharesUnavailable" };

type StructureResult =
  | {
      readonly ok: true;
      readonly path: NotePath;
      /** Set by `delete` when the item went to the trash. */
      readonly trashEntryId?: string;
    }
  | { readonly ok: false; readonly error: StructureError };

export type ShareChangeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: StructureError };

type ConflictResolution = "keepMine" | "keepTheirs" | "editMerged";

type FlushResult =
  | { readonly kind: "saved" }
  | { readonly kind: "unsaved"; readonly count: number };

export type ImportResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * `unsaved`: earlier changes could not be saved first. `outdated`: the
       * changes no longer apply to the working tree.
       */
      readonly reason: "unavailable" | "unsaved" | "outdated";
    };

export interface NotesSnapshot {
  readonly tree: WorkingTree;
  readNote(path: NotePath): Promise<string>;
}

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
  /**
   * Puts the item into `parent` right before its child `before`, or last
   * when `before` is null, moving it there first if it is elsewhere.
   */
  place(
    path: NotePath,
    target: { readonly parent: NotePath; readonly before: string | null },
  ): StructureResult;
  delete(path: NotePath): StructureResult;
  /** Sets the note's color tag, or clears it with null. Saved by autosave. */
  setColorTag(path: NotePath, color: ColorTag | null): StructureResult;
  /** Records a published share of an active note. Saved immediately. */
  addShare(entry: ShareEntry): ShareChangeResult;
  /** Forgets a revoked share. Saved immediately. */
  removeShare(id: string): ShareChangeResult;
  moveFromTrash(
    entryId: string,
    subPath: NotePath,
    newParent: NotePath,
  ): StructureResult;
  undoTrash(entryId: string): StructureResult;
  deleteFromTrash(entryIds: readonly string[]): void;
  emptyTrash(): void;
  purgeExpiredTrash(): void;
  flush(): Promise<FlushResult>;
  retryNow(): void;
  resolveConflict(path: NotePath, resolution: ConflictResolution): void;
  /** Records settings edits and saves them like any other change. */
  changeSettings(edits: SettingsEdits): void;
  dismissNotice(id: number): void;
  snapshotNotes(): NotesSnapshot | null;
  /**
   * Saves earlier changes first, then queues `changes` to be committed on
   * their own as one atomic commit.
   */
  importChanges(changes: ChangeSet): Promise<ImportResult>;
  atomicCommitSupport(): Promise<AtomicCommitSupport>;
  /** Changes forge settings so atomic commits work, then resumes saving. */
  enableAtomicCommits(): Promise<AtomicCommitSupport>;
  /** Resumes a blocked import, committing it without the atomic guarantee. */
  saveImportWithoutAtomic(): void;
  /**
   * Pauses saving, refreshing and every change, so the synced head stays
   * the last thing this engine wrote. Refused (false) unless everything is
   * saved and no conflict is held.
   */
  suspend(): boolean;
  resume(): void;
  dispose(): void;
}

export function mapForgeError(error: ForgeError): SyncError {
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

function appendAll(changes: ChangeSet, more: ChangeSet): ChangeSet {
  let result = changes;
  for (const change of more) {
    result = appendChange(result, change);
  }
  return result;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled change kind: ${(value as Change).kind}`);
}

function failure(error: StructureError): StructureResult {
  return { ok: false, error };
}

function childNames(folder: WorkingFolder, exclude?: string): string[] {
  return folder.children
    .map((child) => child.name)
    .filter((name) => name !== exclude);
}

function validateIn(
  folder: WorkingFolder,
  name: string,
  exclude?: string,
):
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly error: StructureError } {
  const validation = validateName(name, childNames(folder, exclude));
  if (validation.ok) return validation;
  return { ok: false, error: { kind: "invalidName", error: validation.error } };
}

function isFailedSave(save: SaveStatus): boolean {
  return save.kind === "waiting" && save.reason === "failed";
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

const MAX_KEY_BOUND_FILES = 8;

// Folder markers first: an adapter can guard with one without reading it.
function keyBoundFilesOf(synced: SyncedState): KeyBoundFile[] {
  const folders = new Set<string>();
  const notes: KeyBoundFile[] = [];
  function walk(folder: FolderNode): void {
    for (const child of folder.children) {
      if (child.kind === "folder") {
        folders.add(child.storedPath);
        walk(child);
      } else if (notes.length < MAX_KEY_BOUND_FILES) {
        notes.push({ path: child.storedPath, blobSha: child.blobSha });
      }
    }
  }
  walk(synced.tree.root);
  const markers: KeyBoundFile[] = [];
  const suffix = `/${FOLDER_MARKER}`;
  for (const entry of synced.listing) {
    if (markers.length >= MAX_KEY_BOUND_FILES) break;
    if (
      entry.type === "blob" &&
      entry.path.endsWith(suffix) &&
      folders.has(entry.path.slice(0, -suffix.length))
    ) {
      markers.push({ path: entry.path, blobSha: entry.sha });
    }
  }
  return [...markers, ...notes].slice(0, MAX_KEY_BOUND_FILES);
}

const EMPTY_CHANGES: ChangeSet = [];

function workingRawSettings(
  synced: SyncedState | null,
  inFlight: ChangeSet,
  pending: ChangeSet,
): RawSettings {
  if (synced === null) return {};
  let raw = rawSettingsOf(synced.config.settings);
  for (const change of [...inFlight, ...pending]) {
    if (change.kind === "set-settings") {
      raw = applySettingsEdits(raw, change.values);
    }
  }
  return raw;
}
const EMPTY_CONFLICTS: readonly HeldConflict[] = [];

const INITIAL_STATE: SyncEngineState = {
  synced: null,
  refresh: { inFlight: false, lastError: null, lastCompletedAt: null },
  openNote: null,
  workingTree: null,
  trash: null,
  visibleTrash: null,
  shares: null,
  pending: EMPTY_CHANGES,
  inFlight: EMPTY_CHANGES,
  rawSettings: {},
  settings: resolveSettings(SETTINGS_SCHEMA, undefined),
  save: { kind: "idle" },
  conflicts: EMPTY_CONFLICTS,
  notices: [],
  syncStates: computeSyncStates({
    pending: EMPTY_CHANGES,
    inFlight: EMPTY_CHANGES,
    failed: false,
    conflicts: [],
  }),
  stopped: null,
  importing: false,
  atomicBlocked: null,
  suspended: false,
};

const KEY_CHANGED: SyncError = { kind: "keyChanged" };

class KeyChangedError extends Error {
  constructor() {
    super("The repo key no longer matches this session");
  }
}

export function createSyncEngine(options: {
  readonly adapter: ForgeAdapter;
  readonly keyring: Keyring;
  readonly clock: Clock;
  readonly rateBudget?: RateBudget;
  readonly purgeCaps?: PurgeCaps;
}): SyncEngine {
  const { keyring, clock } = options;
  const adapter = options.adapter;
  const rateBudget = options.rateBudget ?? createRateBudget(clock, adapter.limits);

  let state: SyncEngineState = INITIAL_STATE;
  const subscribers = new Set<(state: SyncEngineState) => void>();
  let disposed = false;
  let stopped = false;
  let suspended = false;
  // The config blob last verified against `keyring`; every loaded head is
  // checked against it so no commit is ever based on a re-keyed tree.
  let verifiedConfig: {
    readonly sha: string;
    readonly config: RepoConfig;
  } | null = null;
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
  let purgeAttempted = false;
  // Entries purged by the startup purge; changes purging only these are
  // best-effort and dropped instead of retried.
  const autoPurgedIds = new Set<string>();
  // Whether imported changes are in `pending` / `inFlight`; a commit holding
  // them is requested as atomic.
  let importPending = false;
  let importInFlight = false;
  let importNonAtomic = false;

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
      const working =
        next.synced === null
          ? null
          : buildWorkingState(
              next.synced.tree,
              [...next.inFlight, ...next.pending],
              next.synced.trash,
              next.synced.order,
              next.synced.tags,
              next.synced.shares,
            );
      const rawSettings = workingRawSettings(
        next.synced,
        next.inFlight,
        next.pending,
      );
      result = {
        ...result,
        rawSettings,
        settings: resolveSettings(SETTINGS_SCHEMA, rawSettings),
        workingTree: working?.tree ?? null,
        trash: working?.trash ?? null,
        visibleTrash:
          working === null
            ? null
            : visibleTrashEntries(working.trash, clock.now()),
        shares: working?.shares ?? null,
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
    let next = updater(previous);
    const importing = importPending || importInFlight;
    if (next.importing !== importing) next = { ...next, importing };
    state = derive(previous, next);
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
      ...bodies.map((body) => ({ ...body, id: nextNoticeId++ })),
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
    return readNoteBlob(node.blobSha);
  }

  async function readNoteBlob(blobSha: string): Promise<string> {
    return decryptNote(keyring, await adapter.readBlob(blobSha));
  }

  async function verifyConfig(
    listing: readonly TreeEntry[],
  ): Promise<RepoConfig> {
    const entry = findConfigEntry(listing);
    if (entry === undefined) throw new KeyChangedError();
    if (verifiedConfig?.sha === entry.sha) return verifiedConfig.config;
    const parsed = parseRepoConfig(await adapter.readBlob(entry.sha));
    if (
      parsed.kind !== "valid" ||
      !(await verifyKeyCheck(keyring, parsed.config))
    ) {
      throw new KeyChangedError();
    }
    verifiedConfig = { sha: entry.sha, config: parsed.config };
    return parsed.config;
  }

  async function loadSynced(head: string): Promise<SyncedState> {
    const listing = await adapter.listTree(head);
    const config = await verifyConfig(listing);
    const tree = await buildNoteTree(listing, keyring);
    const trash = await buildTrashIndex(listing, keyring);
    const order = await loadOrder(listing);
    const tags = await loadTags(listing);
    const shares = await loadShares(listing);
    const undecryptableFiles = await countUndecryptableFiles(listing, keyring);
    return {
      head,
      listing,
      tree,
      trash,
      order,
      tags,
      shares,
      config,
      settings: resolveSettings(SETTINGS_SCHEMA, config.settings),
      undecryptableFiles,
    };
  }

  let loadedOrder: { readonly sha: string; readonly order: OrderIndex } | null =
    null;

  async function loadOrder(listing: readonly TreeEntry[]): Promise<OrderIndex> {
    const entry = findOrderEntry(listing);
    if (entry === undefined) return EMPTY_ORDER;
    if (loadedOrder?.sha === entry.sha) return loadedOrder.order;
    const order = await decryptOrderIndex(
      keyring,
      await adapter.readBlob(entry.sha),
    );
    loadedOrder = { sha: entry.sha, order };
    return order;
  }

  let loadedTags: { readonly sha: string; readonly tags: TagIndex } | null =
    null;

  async function loadTags(listing: readonly TreeEntry[]): Promise<TagIndex> {
    const entry = findTagEntry(listing);
    if (entry === undefined) return EMPTY_TAGS;
    if (loadedTags?.sha === entry.sha) return loadedTags.tags;
    const tags = await decryptTagIndex(
      keyring,
      await adapter.readBlob(entry.sha),
    );
    loadedTags = { sha: entry.sha, tags };
    return tags;
  }

  let loadedShares: {
    readonly sha: string;
    readonly shares: ShareIndex;
  } | null = null;

  async function loadShares(
    listing: readonly TreeEntry[],
  ): Promise<ShareIndex> {
    const entry = findSharesFile(listing);
    if (entry === undefined) return EMPTY_SHARES;
    if (loadedShares?.sha === entry.sha) return loadedShares.shares;
    const shares = await decryptShareIndex(
      keyring,
      await adapter.readBlob(entry.sha),
    );
    loadedShares = { sha: entry.sha, shares };
    return shares;
  }

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
    if (syncedNode !== undefined) {
      return { kind: "blob", blobSha: syncedNode.blobSha };
    }
    if (node.trashBlobSha !== undefined) {
      return { kind: "blob", blobSha: node.trashBlobSha };
    }
    return { kind: "missing" };
  }

  function openNoteFor(
    path: NotePath,
    resolution: NoteResolution,
  ): OpenNoteState {
    switch (resolution.kind) {
      case "missing":
        return { kind: "missing", path };
      case "local":
        return {
          kind: "loaded",
          path,
          blobSha: null,
          content: resolution.content,
        };
      case "blob":
        return { kind: "loading", path };
    }
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
      const content = await readNoteBlob(blobSha);
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
          applyOpenNoteResult(epoch, openNoteFor(path, resolution));
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
        applyOpenNoteResult(epoch, openNoteFor(path, resolution));
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
          applyOpenNoteResult(epoch, openNoteFor(path, resolution));
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
      const next = openNoteFor(path, resolution);
      update((current) => ({ ...current, openNote: next }));
      if (resolution.kind === "blob") {
        loading = fetchAndApplyNote(path, resolution.blobSha, epoch);
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

  function appendRebased(change: Change): void {
    update((current) => {
      if (current.synced === null) return current;
      const rebased = rebaseChanges(
        current.synced.tree,
        [...current.inFlight, ...current.pending],
        [change],
        current.synced.trash,
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

    const reads: {
      path: NotePath;
      seenBlobSha: string;
      theirs: { blobSha: string; text: string } | null;
    }[] = [];
    for (const conflict of state.conflicts) {
      const node = syncedNoteAt(synced, workingTree, conflict.path);
      if (node === undefined) {
        reads.push({
          path: conflict.path,
          seenBlobSha: conflict.theirsBlobSha,
          theirs: null,
        });
      } else if (node.blobSha !== conflict.theirsBlobSha) {
        const text = await readNoteBlob(node.blobSha);
        reads.push({
          path: conflict.path,
          seenBlobSha: conflict.theirsBlobSha,
          theirs: { blobSha: node.blobSha, text },
        });
      }
    }
    if (reads.length === 0) return;

    let needsSave = false;
    const paths = new Set<string>();
    for (const { path, seenBlobSha, theirs } of reads) {
      // The conflict may have been resolved or re-taken while the new version loaded.
      const conflict = conflictAt(path);
      if (conflict === undefined || conflict.theirsBlobSha !== seenBlobSha) {
        continue;
      }
      const without = state.conflicts.filter((held) => held !== conflict);

      if (theirs === null) {
        const restored =
          conflict.editing === null
            ? conflict.mine
            : removeConflictMarkerLines(conflict.editing);
        const notice: NoticeBody =
          conflict.editing === null
            ? {
                kind: "merge",
                notice: { kind: "edit-restored", path: conflict.path },
              }
            : { kind: "edited-merge-restored", path: conflict.path };
        update((current) => ({
          ...current,
          conflicts: without,
          notices: notices(current.notices, [notice]),
        }));
        appendRebased({
          kind: "update-note",
          path: conflict.path,
          content: restored,
        });
        needsSave = true;
      } else if (conflict.editing !== null) {
        const rebased = mergeText(
          conflict.theirs,
          conflict.editing,
          theirs.text,
        );
        const fresh = mergeText(conflict.base, conflict.mine, theirs.text);
        const replaced: HeldConflict = {
          ...conflict,
          theirs: theirs.text,
          theirsBlobSha: theirs.blobSha,
          merged: fresh.text,
          editing: rebased.text,
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
      } else {
        const result = mergeText(conflict.base, conflict.mine, theirs.text);
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

  function saveSucceeded(): void {
    consecutiveFailures = 0;
    update((current) => ({
      ...current,
      save: { kind: "idle" },
      atomicBlocked: null,
    }));
  }

  async function atomicCommitSupport(): Promise<AtomicCommitSupport> {
    return (await adapter.atomicCommitSupport?.()) ?? { kind: "available" };
  }

  // Retrying would only be refused again, so the changes stay pending, with
  // no retry scheduled, until the setting is changed or the user opts out.
  async function blockIfAtomicNeedsSetup(): Promise<boolean> {
    let support: AtomicCommitSupport;
    try {
      support = await atomicCommitSupport();
    } catch {
      return false;
    }
    if (support.kind !== "needsSetup") return false;
    cancelRetry();
    returnUncommitted();
    update((current) => ({
      ...current,
      save: {
        kind: "waiting",
        reason: "failed",
        retryAt: null,
        error: { kind: "forbidden" },
      },
      atomicBlocked: { canConfigure: support.canConfigure },
    }));
    return true;
  }

  function resumeBlockedImport(): void {
    if (state.atomicBlocked === null) return;
    update((current) => ({ ...current, atomicBlocked: null }));
    void triggerSave(true);
  }

  async function enableAtomicCommits(): Promise<AtomicCommitSupport> {
    const support = (await adapter.enableAtomicCommits?.()) ?? {
      kind: "available",
    };
    if (support.kind === "available" && !disposed && !stopped) {
      resumeBlockedImport();
    }
    return support;
  }

  function saveImportWithoutAtomic(): void {
    if (disposed || stopped || state.atomicBlocked === null) return;
    importNonAtomic = true;
    resumeBlockedImport();
  }

  // Waits (back-off or rate budget) are only ended by their own timer,
  // retryNow() or flush(); other triggers are ignored.
  function triggerSave(endWait = false): Promise<void> {
    if (disposed || stopped || suspended) return Promise.resolve();
    if (saveLoop !== null) {
      saveAgain = true;
      return saveLoop;
    }
    if (state.synced === null) {
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

  function endImportAttempt(): void {
    if (importInFlight) importNonAtomic = false;
    importInFlight = false;
  }

  async function runOneSave(): Promise<void> {
    update((current) => ({ ...current, save: { kind: "saving" } }));
    let atomicAttempt = false;

    try {
      if (committedHead !== null) {
        await adoptCommittedHead(committedHead);
      }
      if (state.pending.length === 0) {
        saveSucceeded();
        return;
      }

      importInFlight = importPending;
      importPending = false;
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
          order: attemptSynced.order,
          tags: attemptSynced.tags,
          shares: attemptSynced.shares,
          config: attemptSynced.config,
          keyring,
        });
        if (encoded.changes.length === 0) {
          endImportAttempt();
          update((current) => ({ ...current, inFlight: EMPTY_CHANGES }));
          saveSucceeded();
          return;
        }
        atomicAttempt = importInFlight && !importNonAtomic;
        const availableAt = rateBudget.availableAt(
          atomicAttempt
            ? adapter.commitCost(encoded.changes, { atomic: true })
            : adapter.commitCost(encoded.changes),
        );
        if (availableAt > clock.now()) {
          waitForBudget(availableAt);
          return;
        }
        const result = await adapter.commit({
          parent: attemptSynced.head,
          changes: encoded.changes,
          message: encoded.message,
          keyBoundFiles: keyBoundFilesOf(attemptSynced),
          ...(atomicAttempt ? { atomic: true } : {}),
        });

        if (result.kind === "ok") {
          committedHead = result.head;
          endImportAttempt();
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
          endImportAttempt();
          update((current) => ({ ...current, inFlight: EMPTY_CHANGES }));
          saveSucceeded();
          return;
        }
      }
    } catch (error) {
      if (error instanceof KeyChangedError) {
        stopForKeyChange();
        return;
      }
      if (isForgeError(error)) {
        if (
          error.kind === "Forbidden" &&
          atomicAttempt &&
          (await blockIfAtomicNeedsSetup())
        ) {
          return;
        }
        const mapped = mapForgeError(error);
        failAttempt(mapped);
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
    importPending ||= importInFlight;
    importInFlight = false;
    update((current) => ({
      ...current,
      pending: appendAll(current.inFlight, current.pending),
      inFlight: EMPTY_CHANGES,
    }));
  }

  function isAutoPurgeOnly(changes: ChangeSet): boolean {
    return (
      changes.length > 0 &&
      changes.every(
        (change) =>
          change.kind === "purge-trash" &&
          change.entryIds.every((id) => autoPurgedIds.has(id)),
      )
    );
  }

  function dropAutoPurge(error: SyncError | null): boolean {
    if (!isAutoPurgeOnly([...state.inFlight, ...state.pending])) return false;
    if (error !== null) console.error("Trash purge failed", error.kind);
    committedHead = null;
    consecutiveFailures = 0;
    update((current) => ({
      ...current,
      inFlight: EMPTY_CHANGES,
      pending: EMPTY_CHANGES,
      save: { kind: "idle" },
    }));
    return true;
  }

  function failAttempt(error: SyncError): void {
    if (dropAutoPurge(error)) return;
    consecutiveFailures++;
    const retryAt =
      clock.now() +
      retryDelayMs(error, consecutiveFailures);
    returnUncommitted();
    update((current) => ({
      ...current,
      save: {
        kind: "waiting",
        reason: "failed",
        retryAt,
        error,
      },
    }));
    if (state.save.kind === "waiting") scheduleRetry(retryAt);
  }

  function stopForKeyChange(): void {
    stopped = true;
    autosave.cancel();
    cancelRetry();
    returnUncommitted();
    update((current) => ({
      ...current,
      stopped: KEY_CHANGED,
      save: {
        kind: "waiting",
        reason: "failed",
        retryAt: null,
        error: KEY_CHANGED,
      },
    }));
  }

  function waitForBudget(retryAt: number): void {
    if (dropAutoPurge(null)) return;
    returnUncommitted();
    update((current) => ({
      ...current,
      save: {
        kind: "waiting",
        reason: "rateBudget",
        retryAt,
        error: null,
      },
    }));
    if (state.save.kind === "waiting") scheduleRetry(retryAt);
  }

  function touchesPath(change: Change, path: NotePath): boolean {
    switch (change.kind) {
      case "create-note":
      case "update-note":
      case "set-color-tag":
        return notePathEquals(change.path, path);
      case "create-folder":
        return false;
      case "delete-note":
      case "delete-folder":
      case "trash-note":
      case "trash-folder":
        return isAtOrWithin(path, change.path);
      case "rename-note":
      case "rename-folder":
        return isAtOrWithin(path, change.from) || isAtOrWithin(path, change.to);
      case "restore-trash":
        return isAtOrWithin(path, change.to);
      case "purge-trash":
      case "set-order":
      case "set-settings":
      case "add-share":
      case "update-share":
      case "remove-share":
        return false;
    }
  }

  // Merges the in-flight change set with the remote head after a stale
  // commit. Returns whether the merged change set still needs committing.
  async function mergeWithRemote(base: SyncedState): Promise<boolean> {
    const head = await adapter.getHead();
    const remote = await loadSynced(head);

    importInFlight ||= importPending;
    importPending = false;
    update((current) => ({
      ...current,
      inFlight: appendAll(current.inFlight, current.pending),
      pending: EMPTY_CHANGES,
    }));

    const merged = await mergeChangeSet({
      base: base.tree,
      remote: remote.tree,
      changeSet: state.inFlight,
      baseTrash: base.trash,
      remoteTrash: remote.trash,
      remoteShares: remote.shares,
      readBaseContent: (path) => readNoteText(base.tree, path),
      readRemoteContent: (path) => readNoteText(remote.tree, path),
    });

    const mergedTree = buildWorkingTree(
      remote.tree,
      merged.changeSet,
      remote.trash,
      remote.order,
      remote.tags,
      remote.shares,
    );
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

      const rebased = rebaseChanges(
        remote.tree,
        merged.changeSet,
        toRebase,
        remote.trash,
        base.tree,
      );
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
      if (error instanceof KeyChangedError) stopForKeyChange();
      const mapped =
        error instanceof KeyChangedError
          ? KEY_CHANGED
          : isForgeError(error)
            ? mapForgeError(error)
            : null;
      if (mapped !== null) {
        update((current) => ({
          ...current,
          refresh: {
            inFlight: false,
            lastError: mapped,
            lastCompletedAt: current.refresh.lastCompletedAt,
          },
        }));
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
    if (disposed || stopped || suspended) return Promise.resolve();
    if (refreshInFlight !== null) return refreshInFlight;

    const promise = doRefresh().finally(() => {
      if (refreshInFlight === promise) {
        refreshInFlight = null;
      }
    });
    refreshInFlight = promise;
    return promise;
  }

  function snapshotNotes(): NotesSnapshot | null {
    const tree = state.workingTree;
    if (disposed || tree === null) return null;

    const resolutions = new Map<string, NoteResolution>();
    function collect(folder: WorkingFolder): void {
      for (const child of folder.children) {
        if (child.kind === "folder") {
          collect(child);
          continue;
        }
        const conflict = conflictAt(child.path);
        resolutions.set(
          JSON.stringify(child.path),
          conflict === undefined
            ? resolveWorkingNote(child.path)
            : { kind: "local", content: conflict.editing ?? conflict.merged },
        );
      }
    }
    collect(tree.root);

    return {
      tree,
      async readNote(path) {
        const resolution = resolutions.get(JSON.stringify(path));
        switch (resolution?.kind) {
          case "local":
            return resolution.content;
          case "blob":
            return readNoteBlob(resolution.blobSha);
          default:
            throw new Error("No note at the requested path");
        }
      },
    };
  }

  function editNote(path: NotePath, content: string): void {
    if (disposed || suspended || state.workingTree === null) return;
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

  function applyStructureChange(...changes: Change[]): void {
    update((current) => ({
      ...current,
      pending: appendAll(current.pending, changes),
    }));
    for (const change of changes) {
      switch (change.kind) {
        case "rename-note":
        case "rename-folder":
          followRelocation(change.from, change.to);
          break;
        case "delete-note":
        case "delete-folder":
        case "trash-note":
        case "trash-folder":
          followDelete(change.path);
          break;
        case "create-note":
        case "update-note":
        case "create-folder":
        case "restore-trash":
        case "purge-trash":
        case "set-order":
        case "set-settings":
        case "set-color-tag":
        case "add-share":
        case "update-share":
        case "remove-share":
          break;
        default:
          assertNever(change);
      }
    }
    autosave.saveNow();
  }

  function changeSettings(edits: SettingsEdits): void {
    if (disposed || suspended || Object.keys(edits).length === 0) return;
    update((current) => ({
      ...current,
      pending: appendChange(current.pending, {
        kind: "set-settings",
        values: edits,
      }),
    }));
    autosave.saveNow();
  }

  function isConflictedWithin(path: NotePath): boolean {
    return state.conflicts.some((conflict) =>
      isAtOrWithin(conflict.path, path),
    );
  }

  function workingFolderAt(path: NotePath): WorkingFolder | undefined {
    if (state.workingTree === null) return undefined;
    return findWorkingFolder(state.workingTree, path);
  }

  function create(
    kind: "create-note" | "create-folder",
    parent: NotePath,
    name: string,
  ): StructureResult {
    if (disposed || suspended) return failure({ kind: "notFound" });
    const folder = workingFolderAt(parent);
    if (folder === undefined) return failure({ kind: "notFound" });
    const validation = validateIn(folder, name);
    if (!validation.ok) return validation;
    const path = [...parent, validation.name];
    const change: Change =
      kind === "create-note"
        ? { kind, path, content: "" }
        : { kind: "create-folder", path };
    const siblings = childNames(folder);
    const placement =
      kind === "create-note"
        ? state.settings.newNotePlacement
        : state.settings.newFolderPlacement;
    const positioned = positionChange(
      parent,
      siblings,
      validation.name,
      insertionIndex(folder.children, placement),
    );
    applyStructureChange(
      ...(positioned === null ? [change] : [change, positioned]),
    );
    return { ok: true, path };
  }

  // Null when the stored order can't be read, so positions can't be kept.
  function positionChange(
    parent: NotePath,
    siblings: readonly string[],
    name: string,
    index: number,
  ): Extract<Change, { kind: "set-order" }> | null {
    const synced = state.synced;
    if (synced === null || !synced.order.writable) return null;
    const order = buildWorkingState(
      synced.tree,
      [...state.inFlight, ...state.pending],
      synced.trash,
      synced.order,
      synced.tags,
      synced.shares,
    ).order;
    return {
      kind: "set-order",
      parent,
      positions: placementPositions(
        order.folders.get(folderKey(parent)),
        siblings,
        name,
        index,
      ),
    };
  }

  function commandTarget(path: NotePath): WorkingNode | undefined {
    if (
      disposed ||
      suspended ||
      state.workingTree === null ||
      path.length === 0
    ) {
      return undefined;
    }
    return findWorkingNode(state.workingTree, path);
  }

  function rename(path: NotePath, newName: string): StructureResult {
    const node = commandTarget(path);
    if (node === undefined) return failure({ kind: "notFound" });
    if (isConflictedWithin(path)) return failure({ kind: "conflicted" });

    const parent = parentPath(path);
    const folder = workingFolderAt(parent)!;
    const validation = validateIn(folder, newName, node.name);
    if (!validation.ok) return validation;
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
    const node = commandTarget(path);
    if (node === undefined) return failure({ kind: "notFound" });
    const planned = planMove(path, node, newParent);
    if (!planned.ok) return planned;
    applyStructureChange(planned.change);
    return { ok: true, path: planned.change.to };
  }

  function planMove(
    path: NotePath,
    node: WorkingNode,
    newParent: NotePath,
  ):
    | {
        readonly ok: true;
        readonly change: Extract<
          Change,
          { kind: "rename-note" | "rename-folder" }
        >;
      }
    | { readonly ok: false; readonly error: StructureError } {
    if (isConflictedWithin(path)) return { ok: false, error: { kind: "conflicted" } };
    if (
      notePathEquals(newParent, parentPath(path)) ||
      (node.kind === "folder" && isAtOrWithin(newParent, path))
    ) {
      return { ok: false, error: { kind: "invalidTarget" } };
    }
    const target = workingFolderAt(newParent);
    if (target === undefined) {
      return { ok: false, error: { kind: "notFound" } };
    }
    const validation = validateIn(target, node.name);
    if (!validation.ok) return validation;
    return {
      ok: true,
      change: {
        kind: node.kind === "note" ? "rename-note" : "rename-folder",
        from: path,
        to: [...newParent, node.name],
      },
    };
  }

  function place(
    path: NotePath,
    target: { readonly parent: NotePath; readonly before: string | null },
  ): StructureResult {
    const { synced, workingTree } = state;
    if (
      disposed ||
      suspended ||
      synced === null ||
      workingTree === null ||
      path.length === 0
    ) {
      return failure({ kind: "notFound" });
    }
    const node = findWorkingNode(workingTree, path);
    if (node === undefined) return failure({ kind: "notFound" });
    if (!synced.order.writable) return failure({ kind: "orderUnavailable" });
    const folder = workingFolderAt(target.parent);
    if (folder === undefined) return failure({ kind: "notFound" });

    const sameParent = notePathEquals(target.parent, parentPath(path));
    const changes: Change[] = [];
    if (!sameParent) {
      const planned = planMove(path, node, target.parent);
      if (!planned.ok) return planned;
      changes.push(planned.change);
    }
    const placed = [...target.parent, node.name];

    const currentIndex = sameParent
      ? folder.children.findIndex((child) => child.name === node.name)
      : -1;
    const siblings = childNames(folder, sameParent ? node.name : undefined);
    const index =
      target.before === null
        ? siblings.length
        : sameParent && target.before === node.name
          ? currentIndex
          : siblings.indexOf(target.before);
    if (index === -1) return failure({ kind: "notFound" });
    if (sameParent && index === currentIndex) return { ok: true, path: placed };

    changes.push({
      ...positionChange(target.parent, siblings, node.name, index)!,
      moved: node.name,
    });
    applyStructureChange(...changes);
    return { ok: true, path: placed };
  }

  function setColorTag(
    path: NotePath,
    color: ColorTag | null,
  ): StructureResult {
    const { synced, workingTree } = state;
    if (
      disposed ||
      suspended ||
      synced === null ||
      workingTree === null ||
      path.length === 0
    ) {
      return failure({ kind: "notFound" });
    }
    const node = findWorkingNode(workingTree, path);
    if (node?.kind !== "note") return failure({ kind: "notFound" });
    if (!synced.tags.writable) return failure({ kind: "tagsUnavailable" });
    if (node.colorTag === color) return { ok: true, path };

    update((current) => {
      const next = appendChange(current.pending, {
        kind: "set-color-tag",
        path,
        color,
      });
      const withoutLast = next.slice(0, -1);
      const before = buildWorkingState(
        synced.tree,
        [...current.inFlight, ...withoutLast],
        synced.trash,
        synced.order,
        synced.tags,
        synced.shares,
      ).tree;
      const previous = findWorkingNode(before, path);
      const returnsToSaved =
        previous?.kind === "note" && previous.colorTag === color;
      return { ...current, pending: returnsToSaved ? withoutLast : next };
    });
    autosave.noteEdited();
    return { ok: true, path };
  }

  function addShare(entry: ShareEntry): ShareChangeResult {
    const { synced, workingTree } = state;
    if (
      disposed ||
      suspended ||
      synced === null ||
      workingTree === null ||
      entry.note.state !== "active" ||
      findWorkingNode(workingTree, entry.note.path)?.kind !== "note"
    ) {
      return { ok: false, error: { kind: "notFound" } };
    }
    if (!synced.shares.writable) {
      return { ok: false, error: { kind: "sharesUnavailable" } };
    }
    applyStructureChange({ kind: "add-share", entry });
    return { ok: true };
  }

  function removeShare(id: string): ShareChangeResult {
    const { synced, workingTree, shares } = state;
    if (
      disposed ||
      suspended ||
      synced === null ||
      workingTree === null ||
      shares === null
    ) {
      return { ok: false, error: { kind: "notFound" } };
    }
    if (!synced.shares.writable) {
      return { ok: false, error: { kind: "sharesUnavailable" } };
    }
    if (!shares.entries.has(id)) return { ok: true };
    applyStructureChange({ kind: "remove-share", id });
    return { ok: true };
  }

  function deleteItem(path: NotePath): StructureResult {
    const node = commandTarget(path);
    if (node === undefined) return failure({ kind: "notFound" });
    if (isConflictedWithin(path)) return failure({ kind: "conflicted" });
    if (node.kind === "folder" && node.children.length === 0) {
      applyStructureChange({ kind: "delete-folder", path });
      return { ok: true, path };
    }
    const entryId = createTrashEntryId(clock.now(), path.length);
    applyStructureChange(
      node.kind === "note"
        ? { kind: "trash-note", path, entryId }
        : { kind: "trash-folder", path, entryId },
    );
    return { ok: true, path, trashEntryId: entryId };
  }

  function readableTrashEntry(
    entryId: string,
  ): ReadableWorkingTrashEntry | undefined {
    if (disposed || suspended || state.trash === null) return undefined;
    const entry = findWorkingTrashEntry(state.trash, entryId);
    if (
      entry === undefined ||
      entry.undecryptable ||
      isExpired(entry, clock.now())
    ) {
      return undefined;
    }
    return entry;
  }

  // Puts a just-trashed item back where it was. A trash change that has not
  // left the pending queue is dropped, leaving no trace in the history.
  function undoTrash(entryId: string): StructureResult {
    const entry = readableTrashEntry(entryId);
    if (entry === undefined) return failure({ kind: "notFound" });
    const originalParent = parentPath(entry.originalPath);

    const index = state.pending.findIndex(
      (change) =>
        (change.kind === "trash-note" || change.kind === "trash-folder") &&
        change.entryId === entryId,
    );
    const droppable =
      index !== -1 &&
      state.pending
        .slice(index + 1)
        .every((change) => change.kind === "update-note");
    if (!droppable) return restoreRecreatingParents(entry, originalParent);

    const target = workingFolderAt(originalParent);
    if (target === undefined) return failure({ kind: "notFound" });
    const validation = validateIn(target, entry.tree.name);
    if (!validation.ok) return validation;
    update((current) => ({
      ...current,
      pending: current.pending.filter((_, i) => i !== index),
    }));
    return { ok: true, path: entry.originalPath };
  }

  function restoreRecreatingParents(
    entry: ReadableWorkingTrashEntry,
    originalParent: NotePath,
  ): StructureResult {
    const missing: NotePath[] = [];
    let existing = originalParent;
    while (existing.length > 0 && workingFolderAt(existing) === undefined) {
      if (findWorkingNode(state.workingTree!, existing) !== undefined) {
        return failure({
          kind: "invalidName",
          error: { kind: "duplicate" },
        });
      }
      missing.unshift(existing);
      existing = parentPath(existing);
    }
    if (missing.length === 0) return moveFromTrash(entry.id, [], originalParent);

    const item = findTrashItem(entry, []);
    if (item === undefined) return failure({ kind: "notFound" });
    const to = [...originalParent, item.name];
    const changes: Change[] = [
      ...missing.map((path): Change => ({ kind: "create-folder", path })),
      {
        kind: "restore-trash",
        entryId: entry.id,
        subPath: [],
        target: item.kind,
        to,
      },
    ];
    update((current) => ({
      ...current,
      pending: changes.reduce(appendChange, current.pending),
    }));
    autosave.saveNow();
    return { ok: true, path: to };
  }

  function moveFromTrash(
    entryId: string,
    subPath: NotePath,
    newParent: NotePath,
  ): StructureResult {
    const entry = readableTrashEntry(entryId);
    if (entry === undefined) return failure({ kind: "notFound" });
    const item = findTrashItem(entry, subPath);
    if (item === undefined) return failure({ kind: "notFound" });
    const target = workingFolderAt(newParent);
    if (target === undefined) return failure({ kind: "notFound" });
    const validation = validateIn(target, item.name);
    if (!validation.ok) return validation;
    const to = [...newParent, item.name];
    applyStructureChange({
      kind: "restore-trash",
      entryId,
      subPath,
      target: item.kind,
      to,
    });
    return { ok: true, path: to };
  }

  function purge(entryIds: readonly string[]): void {
    if (disposed || suspended || state.trash === null) return;
    const trash = state.trash;
    const known = entryIds.filter(
      (id) => findWorkingTrashEntry(trash, id) !== undefined,
    );
    if (known.length === 0) return;
    applyStructureChange({ kind: "purge-trash", entryIds: known });
  }

  // Expired entries are purged too, even undecryptable ones, since the
  // startup purge would remove them anyway.
  function emptyTrash(): void {
    if (state.trash === null) return;
    const now = clock.now();
    purge(
      state.trash
        .filter((entry) => !entry.undecryptable || isExpired(entry, now))
        .map((entry) => entry.id),
    );
  }

  // Best-effort startup housekeeping: at most one bounded purge commit per
  // engine, only while the rate budget has room to spare.
  function purgeExpiredTrash(): void {
    if (disposed || stopped || suspended || purgeAttempted) return;
    purgeAttempted = true;
    const { synced, trash } = state;
    if (synced === null || trash === null || state.refresh.lastError !== null) {
      return;
    }
    const budgetAt = rateBudget.availableAt(
      adapter.commitCost([]) + TRASH_PURGE_HEADROOM,
    );
    if (budgetAt > clock.now()) return;
    const [batch] = selectExpired(
      synced.trash,
      clock.now(),
      options.purgeCaps,
    );
    if (batch === undefined) return;
    const entryIds = batch
      .map((entry) => entry.id)
      .filter((id) => findWorkingTrashEntry(trash, id) !== undefined);
    if (entryIds.length === 0) return;
    for (const id of entryIds) autoPurgedIds.add(id);
    update((current) => ({
      ...current,
      pending: appendChange(current.pending, {
        kind: "purge-trash",
        entryIds,
      }),
    }));
    autosave.saveNow();
  }

  function flushResult(): FlushResult {
    const count = state.syncStates.unsavedCount;
    return count === 0 ? { kind: "saved" } : { kind: "unsaved", count };
  }

  async function flush(): Promise<FlushResult> {
    autosave.cancel();
    const save = state.save;
    if (stopped || (save.kind === "waiting" && save.reason === "rateBudget")) {
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

  function resolveConflict(
    path: NotePath,
    resolution: ConflictResolution,
  ): void {
    const conflict = conflictAt(path);
    if (disposed || suspended || conflict === undefined) return;

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

  async function importChanges(changes: ChangeSet): Promise<ImportResult> {
    if (disposed || stopped || suspended || state.synced === null) {
      return { ok: false, reason: "unavailable" };
    }
    if (hasLocalWork() || saveLoop !== null) {
      await flush();
      if (disposed || stopped) return { ok: false, reason: "unavailable" };
      if (hasLocalWork()) return { ok: false, reason: "unsaved" };
    }
    if (changes.length === 0) return { ok: true };
    const synced = state.synced!;
    try {
      buildWorkingState(
        synced.tree,
        [...state.inFlight, ...changes],
        synced.trash,
        synced.order,
        synced.tags,
        synced.shares,
      );
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { ok: false, reason: "outdated" };
    }
    importPending = true;
    update((current) => ({ ...current, pending: [...changes] }));
    autosave.cancel();
    void triggerSave(true);
    return { ok: true };
  }

  function suspend(): boolean {
    if (
      disposed ||
      stopped ||
      suspended ||
      state.synced === null ||
      saveLoop !== null ||
      hasLocalWork() ||
      state.conflicts.length > 0 ||
      state.atomicBlocked !== null
    ) {
      return false;
    }
    suspended = true;
    autosave.cancel();
    cancelRetry();
    update((current) => ({ ...current, suspended: true }));
    return true;
  }

  function resume(): void {
    if (!suspended) return;
    suspended = false;
    update((current) => ({ ...current, suspended: false }));
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
    place,
    delete: deleteItem,
    setColorTag,
    addShare,
    removeShare,
    moveFromTrash,
    undoTrash,
    deleteFromTrash: purge,
    emptyTrash,
    purgeExpiredTrash,
    flush,
    retryNow,
    resolveConflict,
    changeSettings,
    dismissNotice,
    snapshotNotes,
    importChanges,
    atomicCommitSupport,
    enableAtomicCommits,
    saveImportWithoutAtomic,
    suspend,
    resume,
    dispose,
  };
}
