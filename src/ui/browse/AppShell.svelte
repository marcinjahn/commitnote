<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { isAtOrWithin, notePathEquals, parentPath } from "../../changes/change";
  import type { SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import type { SettingsSaver } from "../../settings/settings-saver";
  import {
    applySettingsEdits,
    resolveSettings,
    SETTINGS_SCHEMA,
    type Settings,
  } from "../../settings/settings";
  import type { AccentColorId } from "../../settings/accent-palette";
  import type { NoteFont } from "../../settings/note-font";
  import type { NoteHistory, NoteVersion } from "../../history/note-history";
  import type { NoteDates, NoteDatesResolver } from "../../history/note-dates";
  import type { RestorePlan } from "../../history/plan-restore";
  import { validateName } from "../../tree/note-names";
  import { describeNameError } from "../dialogs/name-messages";
  import {
    describeRestoreBlock,
    describeRestored,
    UNSAVED_BEFORE_RESTORE_MESSAGE,
  } from "../history/history-messages";
  import { findWorkingNode } from "../../sync/working-tree";
  import { findNode } from "../../tree/note-tree";
  import NoteHistoryDialog, {
    type HistoryPhase,
  } from "../history/NoteHistoryDialog.svelte";
  import type { WorkingNode } from "../../sync/working-tree";
  import { downloadNotesArchive } from "../../export/download-notes-archive";
  import {
    planImport,
    type CollisionPolicy,
    type ImportDestination,
    type ImportSummary,
  } from "../../import/plan-import";
  import {
    MAX_ARCHIVE_UNCOMPRESSED_BYTES,
    NotesArchiveError,
    readNotesArchive,
    type NotesArchiveContents,
  } from "../../import/read-notes-archive";
  import ImportDialog from "../import/ImportDialog.svelte";
  import AtomicBlockedDialog from "../import/AtomicBlockedDialog.svelte";
  import {
    describeArchiveError,
    describeEnableAtomicFailure,
    describeImportDone,
    describeImportRefusal,
    IMPORT_RETRYING_MESSAGE,
  } from "../import/import-messages";
  import type { ImportOutcome } from "../import/import-outcome";
  import type { Keyring } from "../../crypto/keyring";
  import type {
    HistoryOutcome,
    LandedCheck,
    PassphraseChange,
  } from "../../rekey/change-passphrase";
  import ChangePassphraseDialog from "../passphrase/ChangePassphraseDialog.svelte";
  import DeleteDialog from "../dialogs/DeleteDialog.svelte";
  import { actionIcons, commandIcons } from "./action-icons";
  import CommandMenu from "./CommandMenu.svelte";
  import CommitSha from "./CommitSha.svelte";
  import { countDescendants } from "../dialogs/folder-options";
  import MoveDialog from "../dialogs/MoveDialog.svelte";
  import ConfirmDialog from "../dialogs/ConfirmDialog.svelte";
  import NameDialog from "../dialogs/NameDialog.svelte";
  import SettingsDialog from "../dialogs/SettingsDialog.svelte";
  import { decideNameCommit } from "../note/name-field-commit";
  import { resolveNoteDraft, type NoteDraft } from "../note/note-draft";
  import NotePane from "../note/NotePane.svelte";
  import { derivePrintNote, type PrintNote } from "../print/print-note";
  import type { ToastMessage } from "../notices/notice-messages";
  import NoticeToasts from "../notices/NoticeToasts.svelte";
  import NoteHeader from "./NoteHeader.svelte";
  import NoteTree from "./NoteTree.svelte";
  import RefreshButton from "./RefreshButton.svelte";
  import SettingsSaveIndicator from "../settings/SettingsSaveIndicator.svelte";
  import { settingsSaveState } from "../../settings/settings-save-state";
  import TrashDialog from "../trash/TrashDialog.svelte";
  import {
    describeEmptyTrash,
    describeMovedToTrash,
    describeUndoError,
  } from "../trash/trash-messages";
  import type { ReadableWorkingTrashEntry } from "../../sync/working-trash";
  import Wordmark from "../wordmark/Wordmark.svelte";
  import type { Command, RowAction } from "./row-menu-types";
  import { describeMovedTo, describeStructureError } from "./structure-messages";
  import type { DropTarget } from "./tree-drop";
  import { DRAG_EASING, DRAG_MOTION_MS, prefersReducedMotion } from "./drag-motion";
  import { describeSyncError, describeUndecryptableFiles } from "./sync-messages";

  interface Props {
    engine: SyncEngine;
    settingsSaver: SettingsSaver;
    repoLabel: string;
    repoUrl: string;
    forgeName: string;
    passphraseChange: PassphraseChange;
    noteHistory: NoteHistory;
    noteDatesResolver: NoteDatesResolver;
    initialMessage?: string | null;
    onPassphraseChanged: (
      keyring: Keyring,
      check: LandedCheck,
      history: HistoryOutcome,
    ) => void;
    onLogOut: () => void;
    onAccentColor: (id: AccentColorId) => void;
    onNoteFont: (id: NoteFont) => void;
    onPrintNote: (note: PrintNote | null) => void;
  }

  const {
    engine,
    settingsSaver,
    repoLabel,
    repoUrl,
    forgeName,
    passphraseChange,
    noteHistory,
    noteDatesResolver,
    initialMessage = null,
    onPassphraseChanged,
    onLogOut,
    onAccentColor,
    onNoteFont,
    onPrintNote,
  }: Props = $props();

  let engineState = $state<SyncEngineState>(untrack(() => engine.getState()));
  let pendingSettingsEdits = $state(untrack(() => settingsSaver.pending));
  let mobileView = $state<"tree" | "note">("tree");
  let repoLabelEl = $state<HTMLSpanElement | null>(null);
  let repoLabelTruncated = $state(false);

  $effect(() => {
    const el = repoLabelEl;
    if (el === null) return;
    void repoLabel;
    const measure = () => {
      repoLabelTruncated = el.scrollWidth > el.clientWidth;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  type DialogState =
    | { readonly kind: "none" }
    | {
        readonly kind: "createFolder";
        readonly parent: NotePath;
        readonly siblingNames: readonly string[];
        readonly error: string | null;
      }
    | {
        readonly kind: "rename";
        readonly node: WorkingNode;
        readonly siblingNames: readonly string[];
        readonly error: string | null;
      }
    | {
        readonly kind: "move";
        readonly node: WorkingNode;
        readonly error: string | null;
      }
    | {
        readonly kind: "delete";
        readonly node: WorkingNode;
        readonly itemCount: number;
        readonly error: string | null;
      };

  type TrashDialogState =
    | { readonly kind: "none" }
    | {
        readonly kind: "restore";
        readonly entry: ReadableWorkingTrashEntry;
        readonly node: WorkingNode;
        readonly error: string | null;
      }
    | { readonly kind: "deleteEntry"; readonly entry: ReadableWorkingTrashEntry }
    | { readonly kind: "empty" };

  let trashOpen = $state(false);
  let trashNow = $state(Date.now());
  let trashDialog = $state<TrashDialogState>({ kind: "none" });
  let dialog = $state<DialogState>({ kind: "none" });
  let nameError = $state<string | null>(null);
  let nameResetKey = $state(0);
  let expandRequest = $state<{ readonly path: NotePath } | null>(null);
  let draft = $state<NoteDraft | null>(null);
  let draftError = $state<string | null>(null);
  let draftSession = $state(0);
  let pendingFieldText = $state<string | null>(null);
  let focusEditorOnEnter = false;
  let notePane: ReturnType<typeof NotePane> | undefined = $state();
  let notePaneEl: HTMLElement | undefined = $state();
  let refreshMessages = $state<readonly ToastMessage[]>([]);
  let nextMessageId = 0;
  let exporting = $state(false);
  let exportMessages = $state<readonly ToastMessage[]>([]);
  const UNDO_TOAST_MS = 8_000;
  let trashMessages = $state<readonly ToastMessage[]>([]);
  let placeMessages = $state<readonly ToastMessage[]>([]);
  let importInput: HTMLInputElement | undefined = $state();
  let reading = $state(false);
  let importDialog = $state<{
    readonly fileName: string;
    readonly contents: NotesArchiveContents;
  } | null>(null);
  let importStarted = $state<{
    readonly summary: ImportSummary;
    retryingShown: boolean;
  } | null>(null);
  let importMessages = $state<readonly ToastMessage[]>([]);
  let atomicBlockedOpen = $state(false);
  let changePassphraseOpen = $state(false);
  let settingsOpen = $state(false);
  let historyDialog = $state<{
    readonly path: NotePath;
    readonly phase: HistoryPhase;
  } | null>(null);
  let historyMessages = $state<readonly ToastMessage[]>([]);
  interface UndoGuard {
    readonly id: number;
    readonly path: NotePath;
    readonly content: string;
  }
  let undoGuard = $state<UndoGuard | null>(null);
  let sessionMessages = $state<readonly ToastMessage[]>(
    untrack(() =>
      initialMessage === null ? [] : [{ id: -1, text: initialMessage }],
    ),
  );
  let atomicBlockedSeen = false;

  $effect(() => {
    return engine.subscribe((next) => {
      engineState = next;
    });
  });

  $effect(() => {
    pendingSettingsEdits = settingsSaver.pending;
    return settingsSaver.subscribe(() => {
      pendingSettingsEdits = settingsSaver.pending;
    });
  });

  const settings: Settings = $derived(
    resolveSettings(
      SETTINGS_SCHEMA,
      applySettingsEdits(engineState.rawSettings, pendingSettingsEdits),
    ),
  );

  $effect(() => {
    onAccentColor(settings.accentColor);
  });

  $effect(() => {
    onNoteFont(settings.noteFont);
  });

  const printNote = $derived(
    derivePrintNote(draft, engineState.openNote, engineState.conflicts),
  );

  $effect(() => {
    onPrintNote(printNote);
  });

  const settingsSave = $derived(
    settingsSaveState({
      engine: engineState.syncStates.settings,
      stored: engineState.rawSettings,
      heldEdits: pendingSettingsEdits,
    }),
  );

  function changeSettings(edits: Partial<Settings>): void {
    settingsSaver.change(edits);
  }

  function openSettings(): void {
    leaveDraft();
    settingsOpen = true;
  }

  const tree = $derived(engineState.workingTree);
  const treeLoading = $derived(engineState.synced === null && engineState.refresh.inFlight);
  const trashEntries = $derived(engineState.visibleTrash ?? []);
  const selectedPath = $derived(engineState.openNote?.path ?? null);
  const conflictPaths = $derived(engineState.conflicts.map((held) => held.path));
  const refreshing = $derived(engineState.refresh.inFlight);
  const head = $derived(engineState.synced?.head ?? null);

  const importing = $derived(engineState.importing || importStarted !== null);
  const commands: readonly Command[] = $derived([
    {
      id: "settings",
      label: "Settings",
      icon: commandIcons.settings,
      run: openSettings,
    },
    {
      id: "export",
      label: exporting ? "Exporting…" : "Export notes",
      icon: commandIcons.export,
      disabled: tree === null || exporting,
      run: () => void handleExport(),
    },
    {
      id: "import",
      label: importing ? "Importing…" : "Import notes",
      icon: commandIcons.import,
      disabled:
        tree === null || engineState.stopped !== null || importing || reading,
      run: () => importInput?.click(),
    },
    {
      id: "change-passphrase",
      label: "Change passphrase",
      icon: commandIcons.passphrase,
      disabled: tree === null || engineState.stopped !== null || importing,
      run: () => {
        settingsSaver.flush();
        leaveDraft();
        changePassphraseOpen = true;
      },
    },
    {
      id: "log-out",
      label: "Log out",
      icon: commandIcons.logOut,
      run: handleLogOut,
    },
  ]);

  const openPath = $derived(engineState.openNote?.path ?? null);
  const openConflicted = $derived(
    openPath !== null &&
      engineState.conflicts.some((held) => notePathEquals(held.path, openPath)),
  );

  const NOTE_DATES_DEBOUNCE_MS = 3000;

  let shownDates = $state<{ path: NotePath; dates: NoteDates } | null>(null);
  // Any change of the loaded note's path starts a new opening: a different
  // note, or the same note relocated. The dates cache for a path is trusted
  // only when the note was opened from its committed blob and the entry was
  // resolved for that blob; otherwise the entry may belong to an earlier note
  // at that path.
  let openingKey: string | null = null;
  let opening = 0;
  let openingHandled = false;
  let openingTrustsCache = false;

  const loadedKey = $derived(
    engineState.openNote?.kind === "loaded" ? engineState.openNote.path.join("/") : null,
  );
  const loadedBlobSha = $derived(
    engineState.openNote?.kind === "loaded" ? engineState.openNote.blobSha : null,
  );
  const headHasOpenNote = $derived.by(() => {
    const open = engineState.openNote;
    const synced = engineState.synced;
    if (open?.kind !== "loaded" || open.blobSha === null || synced === null) return false;
    const node = findNode(synced.tree, open.path);
    return node?.kind === "note" && node.blobSha === open.blobSha;
  });
  const saveIdle = $derived(engineState.save.kind === "idle");

  const noteDates = $derived.by(() => {
    const open = engineState.openNote;
    if (shownDates === null || open?.kind !== "loaded") return null;
    return notePathEquals(shownDates.path, open.path) ? shownDates.dates : null;
  });

  $effect(() => {
    const key = loadedKey;
    const blobSha = loadedBlobSha;
    const idle = saveIdle;
    if (key !== openingKey) {
      openingTrustsCache = openingKey === null && blobSha !== null;
      openingKey = key;
      opening += 1;
      openingHandled = false;
      shownDates = null;
    }
    if (key === null || blobSha === null || !headHasOpenNote) return;
    const state = untrack(() => engine.getState());
    const open = state.openNote;
    const head = state.synced?.head;
    if (open?.kind !== "loaded" || head === undefined) return;
    const path = open.path;

    const justOpened = !openingHandled;
    openingHandled = true;
    if (justOpened && noteDatesResolver.cached(path)?.blobSha !== blobSha) {
      openingTrustsCache = false;
    }
    if (!openingTrustsCache) {
      noteDatesResolver.forget(path);
      openingTrustsCache = true;
    }
    const entry = noteDatesResolver.cached(path);
    if (entry !== null) shownDates = { path, dates: entry.dates };
    if (entry?.blobSha === blobSha) return;

    const resolvingFor = opening;
    const resolve = (): void => {
      noteDatesResolver.resolve(path, head, blobSha).then(
        (dates) => {
          if (resolvingFor === opening) shownDates = { path, dates };
        },
        () => {},
      );
    };

    if (justOpened || entry === null) {
      resolve();
      return;
    }
    if (!idle) return;
    const timer = setTimeout(resolve, NOTE_DATES_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const historyCurrent = $derived.by(() => {
    const open = engineState.openNote;
    if (historyDialog === null || open?.kind !== "loaded") return null;
    return notePathEquals(open.path, historyDialog.path) ? open.content : null;
  });

  $effect(() => {
    if (
      historyDialog !== null &&
      (openPath === null || !notePathEquals(openPath, historyDialog.path))
    ) {
      historyDialog = null;
    }
  });

  async function openHistory(): Promise<void> {
    const path = openPath;
    if (path === null) return;
    historyDialog = { path, phase: { kind: "saving" } };
    try {
      await engine.flush();
    } catch {
      // Best effort: the history of what is saved can still be shown.
    }
    if (historyDialog === null || !notePathEquals(historyDialog.path, path)) {
      return;
    }
    const synced = engine.getState().synced;
    const node = synced === null ? undefined : findNode(synced.tree, path);
    historyDialog = {
      path,
      phase:
        synced === null || node?.kind !== "note"
          ? { kind: "unsaved" }
          : { kind: "ready", cursor: noteHistory.open(path, synced.head) },
    };
  }

  type NoteStateResult =
    | { readonly ok: true; readonly path: NotePath }
    | { readonly ok: false; readonly message: string };

  // The name is checked up front so a failed rename leaves the content alone,
  // and the edit goes first so the rename's save commits both together.
  function setNoteState(
    path: NotePath,
    content: string | null,
    name: string | null,
  ): NoteStateResult {
    if (
      engineState.conflicts.some((held) => notePathEquals(held.path, path))
    ) {
      return {
        ok: false,
        message: describeStructureError({ kind: "conflicted" }),
      };
    }
    if (name !== null) {
      const validation = validateName(
        name,
        siblingNamesOf(parentPath(path), noteName(path)),
      );
      if (!validation.ok) {
        return { ok: false, message: describeNameError(validation.error) };
      }
    }
    if (content !== null) engine.editNote(path, content);
    if (name === null) return { ok: true, path };
    const result = engine.rename(path, name);
    return result.ok
      ? { ok: true, path: result.path }
      : { ok: false, message: describeStructureError(result.error) };
  }

  async function handleHistoryRestore(
    plan: Extract<RestorePlan, { kind: "ready" }>,
    version: NoteVersion,
  ): Promise<string | null> {
    const path = historyDialog?.path;
    if (path === undefined) return null;
    try {
      await engine.flush();
    } catch {
      // The note's sync state below tells whether its changes were saved.
    }
    const state = engine.getState();
    const open = state.openNote;
    if (
      historyDialog === null ||
      !notePathEquals(historyDialog.path, path) ||
      open?.kind !== "loaded" ||
      !notePathEquals(open.path, path)
    ) {
      return null;
    }
    if (state.stopped !== null || state.suspended) {
      return describeRestoreBlock("unavailable");
    }
    if (state.syncStates.stateOf(path).kind !== "synced") {
      return UNSAVED_BEFORE_RESTORE_MESSAGE;
    }
    const previous = { content: open.content, name: noteName(path) };
    const result = setNoteState(path, plan.content, plan.name);
    if (!result.ok) return result.message;
    historyDialog = null;
    const restoredPath = result.path;
    const restored = engine.getState().openNote;
    const id = ++nextMessageId;
    undoGuard =
      restored?.kind === "loaded"
        ? { id, path: restored.path, content: restored.content }
        : null;
    historyMessages = [
      {
        id,
        text: describeRestored(version.committedAt, Date.now()),
        durationMs: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          run: () =>
            handleUndoRestore(
              id,
              restoredPath,
              plan.content === null ? null : previous.content,
              plan.name === null ? null : previous.name,
            ),
        },
      },
    ];
    return null;
  }

  function undoApplies(
    guard: UndoGuard,
    open: SyncEngineState["openNote"],
  ): boolean {
    return (
      open?.kind === "loaded" &&
      notePathEquals(open.path, guard.path) &&
      open.content === guard.content
    );
  }

  function dismissUndo(id: number): void {
    if (undoGuard?.id === id) undoGuard = null;
    historyMessages = historyMessages.filter((message) => message.id !== id);
  }

  $effect(() => {
    const guard = undoGuard;
    if (guard !== null && !undoApplies(guard, engineState.openNote)) {
      dismissUndo(guard.id);
    }
  });

  function handleUndoRestore(
    id: number,
    path: NotePath,
    content: string | null,
    name: string | null,
  ): void {
    const guard = undoGuard;
    if (
      guard === null ||
      guard.id !== id ||
      !undoApplies(guard, engine.getState().openNote)
    ) {
      dismissUndo(id);
      return;
    }
    undoGuard = null;
    const result = setNoteState(path, content, name);
    historyMessages = result.ok
      ? []
      : [{ id: ++nextMessageId, text: result.message }];
  }

  $effect(() => {
    if (trashOpen && trashEntries.length === 0) {
      trashOpen = false;
      trashDialog = { kind: "none" };
    }
  });

  let previousOpenPath: NotePath | null = null;
  $effect(() => {
    const path = openPath;
    if (
      previousOpenPath === null ||
      path === null ||
      !notePathEquals(previousOpenPath, path)
    ) {
      nameError = null;
    }
    previousOpenPath = path;
  });

  function noteName(path: NotePath): string {
    return path[path.length - 1];
  }

  function handleSelect(path: NotePath): Promise<void> {
    leaveDraft();
    mobileView = "note";
    return engine.openNote(path);
  }

  // On narrow screens the tree and the note pane are never shown together.
  function noteDropArea(): HTMLElement | null {
    return window.matchMedia("(min-width: 768px)").matches
      ? (notePaneEl ?? null)
      : null;
  }

  function slideIn(element: Element): void {
    element.animate(
      [
        { opacity: 0, translate: "0 6px" },
        { opacity: 1, translate: "0 0" },
      ],
      { duration: DRAG_MOTION_MS, easing: DRAG_EASING },
    );
  }

  // The header slides in at once; the note's text once it has loaded.
  async function handleDropOpen(path: NotePath): Promise<void> {
    const opening = handleSelect(path);
    await tick();
    const pane = notePaneEl;
    if (pane === undefined || prefersReducedMotion()) return;
    const content = pane.lastElementChild;
    for (const child of pane.children) {
      if (child !== content) slideIn(child);
    }
    await opening;
    await tick();
    if (content !== null && openPath !== null && notePathEquals(openPath, path)) {
      slideIn(content);
    }
  }

  function handleBack(): void {
    leaveDraft();
    mobileView = "tree";
  }

  function handleLogOut(): void {
    leaveDraft();
    onLogOut();
  }

  function leaveDraft(): void {
    if (draft === null) return;
    const action = resolveNoteDraft(draft, { kind: "left" }, []);
    if (action.kind === "discard") {
      draft = null;
      draftError = null;
    }
  }

  function startDraft(parent: NotePath): void {
    leaveDraft();
    void engine.openNote(null);
    draft = { parent, name: "" };
    draftError = null;
    draftSession += 1;
    mobileView = "note";
  }

  function handleDraftNameInput(edited: string): void {
    if (draft === null) return;
    draft = { ...draft, name: edited };
  }

  function handleDraftNameCommit(edited: string): void {
    if (draft === null) return;
    draft = { ...draft, name: edited };
    const action = resolveNoteDraft(
      draft,
      { kind: "nameConfirmed" },
      siblingNamesOf(draft.parent),
    );
    switch (action.kind) {
      case "showError":
        draftError = action.message;
        break;
      case "create": {
        const result = engine.createNote(action.parent, action.name);
        if (!result.ok) {
          draftError = describeStructureError(result.error);
          break;
        }
        draft = null;
        draftError = null;
        focusEditorOnEnter = true;
        expandFolder(action.parent);
        void engine.openNote(result.path);
        break;
      }
    }
  }

  function handleDraftContent(content: string): void {
    if (draft === null) return;
    const action = resolveNoteDraft(
      draft,
      { kind: "contentChanged", content, now: new Date() },
      siblingNamesOf(draft.parent),
    );
    if (action.kind !== "createWithContent") return;
    const result = engine.createNote(action.parent, action.name);
    if (!result.ok) {
      draftError = describeStructureError(result.error);
      return;
    }
    engine.editNote(result.path, action.content);
    if (action.fieldError !== null) {
      pendingFieldText = draft.name;
      nameError = action.fieldError;
      // Keeps the open-path effect from clearing the carried-over field error.
      previousOpenPath = result.path;
    }
    void engine.openNote(result.path);
    expandFolder(action.parent);
    draft = null;
    draftError = null;
  }

  function handleNameEnterDone(): void {
    if (!focusEditorOnEnter) return;
    focusEditorOnEnter = false;
    notePane?.focusEditor();
  }

  function showRefreshError(text: string): void {
    // The inline alert explains an empty sidebar; a toast would repeat it.
    if (tree === null) return;
    refreshMessages = [{ id: ++nextMessageId, text }];
  }

  async function handleRefresh(): Promise<boolean> {
    try {
      await engine.refresh();
    } catch {
      showRefreshError("Refresh failed. Try again later.");
      return false;
    }
    const error = engine.getState().refresh.lastError;
    if (error === null) {
      refreshMessages = [];
      return true;
    }
    showRefreshError(describeSyncError(error, forgeName));
    return false;
  }

  async function handleExport(): Promise<void> {
    const snapshot = engine.snapshotNotes();
    if (snapshot === null || exporting) return;
    exporting = true;
    exportMessages = [];
    try {
      await downloadNotesArchive(snapshot);
    } catch {
      exportMessages = [{ id: ++nextMessageId, text: "Export failed. Try again later." }];
    } finally {
      exporting = false;
    }
  }

  function showImportMessage(text: string): void {
    importMessages = [{ id: ++nextMessageId, text }];
  }

  $effect(() => {
    const started = importStarted;
    if (started === null) return;
    const { importing: busy, save, stopped } = engineState;
    if (stopped !== null) {
      importStarted = null;
      return;
    }
    if (!busy) {
      importStarted = null;
      showImportMessage(
        describeImportDone(started.summary.notes, started.summary.folders),
      );
      return;
    }
    if (
      !started.retryingShown &&
      engineState.atomicBlocked === null &&
      save.kind === "waiting" &&
      save.reason === "failed"
    ) {
      started.retryingShown = true;
      showImportMessage(IMPORT_RETRYING_MESSAGE);
    }
  });

  $effect(() => {
    const blocked = engineState.atomicBlocked !== null;
    if (blocked && !atomicBlockedSeen) atomicBlockedOpen = true;
    if (!blocked) atomicBlockedOpen = false;
    atomicBlockedSeen = blocked;
  });

  async function handleEnableAtomic(): Promise<string | null> {
    try {
      const support = await engine.enableAtomicCommits();
      return support.kind === "available"
        ? null
        : describeEnableAtomicFailure(forgeName);
    } catch {
      return describeEnableAtomicFailure(forgeName);
    }
  }

  async function handleImportFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined || reading) return;
    importMessages = [];
    if (file.size > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      showImportMessage(describeArchiveError("tooLarge"));
      return;
    }
    reading = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      importDialog = { fileName: file.name, contents: readNotesArchive(bytes) };
    } catch (error) {
      showImportMessage(
        describeArchiveError(
          error instanceof NotesArchiveError ? error.kind : "invalidArchive",
        ),
      );
    } finally {
      reading = false;
    }
  }

  async function handleImport(
    destination: ImportDestination,
    policy: CollisionPolicy,
  ): Promise<ImportOutcome> {
    const pending = importDialog;
    if (pending === null) return { kind: "error", message: describeImportRefusal("unavailable") };
    try {
      const support = await engine.atomicCommitSupport();
      if (support.kind === "needsSetup") {
        return { kind: "needsSetup", canConfigure: support.canConfigure };
      }
    } catch {
      return {
        kind: "error",
        message: `Could not reach ${forgeName}. Try again later.`,
      };
    }
    // A save before the import can change the tree, so the plan is redone once
    // when it no longer applies.
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = engine.getState().workingTree;
      if (current === null) {
        return { kind: "error", message: describeImportRefusal("unavailable") };
      }
      let plan;
      try {
        plan = planImport(current, destination, pending.contents.entries, policy);
      } catch {
        return {
          kind: "error",
          message: "The destination folder no longer exists.",
        };
      }
      if (!plan.ok) return { kind: "conflicts", count: plan.conflicts };
      const result = await engine.importChanges(plan.changes);
      if (result.ok) {
        importDialog = null;
        if (plan.changes.length > 0) {
          importStarted = { summary: plan.summary, retryingShown: false };
        }
        const first = plan.changes[0];
        if (destination.kind === "folder") {
          expandFolder(destination.path);
        } else if (destination.kind === "new-folder" && first !== undefined) {
          expandFolder(first.kind === "create-folder" ? first.path : []);
        }
        return { kind: "queued" };
      }
      if (result.reason !== "outdated") {
        return { kind: "error", message: describeImportRefusal(result.reason) };
      }
    }
    return { kind: "error", message: describeImportRefusal("outdated") };
  }

  function expandFolder(path: NotePath): void {
    expandRequest = { path };
  }

  function siblingNamesOf(parent: NotePath, exclude?: string): string[] {
    if (tree === null) return [];
    const folder = findWorkingNode(tree, parent);
    if (folder === undefined || folder.kind !== "folder") return [];
    return folder.children
      .map((child) => child.name)
      .filter((childName) => childName !== exclude);
  }

  function closeDialog(): void {
    dialog = { kind: "none" };
  }

  function handleHeaderNewNote(): void {
    startDraft([]);
  }

  function handleHeaderNewFolder(): void {
    dialog = {
      kind: "createFolder",
      parent: [],
      siblingNames: siblingNamesOf([]),
      error: null,
    };
  }

  function handleTreeAction(action: RowAction, node: WorkingNode): void {
    switch (action) {
      case "new-note":
        startDraft(node.path);
        break;
      case "new-folder":
        dialog = {
          kind: "createFolder",
          parent: node.path,
          siblingNames: siblingNamesOf(node.path),
          error: null,
        };
        break;
      case "rename":
        if (node.kind !== "folder") break;
        dialog = {
          kind: "rename",
          node,
          siblingNames: siblingNamesOf(parentPath(node.path), node.name),
          error: null,
        };
        break;
      case "move":
        dialog = { kind: "move", node, error: null };
        break;
      case "delete":
        dialog = {
          kind: "delete",
          node,
          itemCount: node.kind === "folder" ? countDescendants(node) : 0,
          error: null,
        };
        break;
    }
  }

  function handleCreateFolderSubmit(name: string): void {
    if (dialog.kind !== "createFolder") return;
    const result = engine.createFolder(dialog.parent, name);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    const parent = dialog.parent;
    closeDialog();
    expandFolder(parent);
  }

  function handleRenameSubmit(newName: string): void {
    if (dialog.kind !== "rename") return;
    const result = engine.rename(dialog.node.path, newName);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    closeDialog();
  }

  function handleNameCommit(edited: string): void {
    focusEditorOnEnter = false;
    if (draft !== null) {
      handleDraftNameCommit(edited);
      return;
    }
    if (openPath === null) return;
    const currentName = noteName(openPath);
    const decision = decideNameCommit({
      currentName,
      edited,
      siblingNames: siblingNamesOf(parentPath(openPath), currentName),
      conflicted: openConflicted,
    });
    switch (decision.kind) {
      case "noop":
        nameError = null;
        break;
      case "restore":
        nameError = null;
        nameResetKey += 1;
        break;
      case "error":
        nameError = decision.message;
        break;
      case "commit": {
        const result = engine.rename(openPath, decision.name);
        nameError = result.ok ? null : describeStructureError(result.error);
        break;
      }
    }
  }

  function handleNameEscape(): void {
    if (draft !== null) {
      draftError = null;
      return;
    }
    nameError = null;
  }

  function handleMoveSubmit(newParent: NotePath): void {
    if (dialog.kind !== "move") return;
    const result = engine.move(dialog.node.path, newParent);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    closeDialog();
  }

  function handlePlace(path: NotePath, target: DropTarget): NotePath | null {
    const from = parentPath(path);
    const name = noteName(path);
    const folder = tree === null ? undefined : findWorkingNode(tree, from);
    const siblings =
      folder?.kind === "folder" ? folder.children.map((child) => child.name) : [];
    const previousBefore = siblings[siblings.indexOf(name) + 1] ?? null;

    const result = engine.place(path, target);
    if (!result.ok) {
      placeMessages = [
        { id: ++nextMessageId, text: describeStructureError(result.error) },
      ];
      return null;
    }
    const placed = result.path;
    placeMessages = notePathEquals(from, target.parent)
      ? []
      : [
          {
            id: ++nextMessageId,
            text: describeMovedTo(name, target.parent),
            durationMs: UNDO_TOAST_MS,
            action: {
              label: "Undo",
              run: () =>
                handleUndoPlace(placed, { parent: from, before: previousBefore }),
            },
          },
        ];
    return placed;
  }

  function handleUndoPlace(path: NotePath, target: DropTarget): void {
    const result = engine.place(path, target);
    placeMessages = result.ok
      ? []
      : [{ id: ++nextMessageId, text: describeStructureError(result.error) }];
  }

  function dismissMessage(id: number): void {
    refreshMessages = refreshMessages.filter((message) => message.id !== id);
    exportMessages = exportMessages.filter((message) => message.id !== id);
    trashMessages = trashMessages.filter((message) => message.id !== id);
    placeMessages = placeMessages.filter((message) => message.id !== id);
    importMessages = importMessages.filter((message) => message.id !== id);
    historyMessages = historyMessages.filter((message) => message.id !== id);
    sessionMessages = sessionMessages.filter((message) => message.id !== id);
  }

  function openTrash(): void {
    trashNow = Date.now();
    trashOpen = true;
  }

  function closeTrashDialog(): void {
    trashDialog = { kind: "none" };
  }

  function handleTrashRestoreSubmit(newParent: NotePath): void {
    if (trashDialog.kind !== "restore") return;
    const { entry, node } = trashDialog;
    const result = engine.moveFromTrash(
      entry.id,
      node.path.slice(entry.originalPath.length),
      newParent,
    );
    if (!result.ok) {
      trashDialog = { ...trashDialog, error: describeStructureError(result.error) };
      return;
    }
    closeTrashDialog();
  }

  function handleTrashDeleteConfirm(): void {
    if (trashDialog.kind === "deleteEntry") {
      engine.deleteFromTrash([trashDialog.entry.id]);
    } else if (trashDialog.kind === "empty") {
      engine.emptyTrash();
    }
    closeTrashDialog();
  }

  function handleUndoTrash(entryId: string, reopen: NotePath | null): void {
    const result = engine.undoTrash(entryId);
    if (!result.ok) {
      trashMessages = [
        { id: ++nextMessageId, text: describeUndoError(result.error) },
      ];
      return;
    }
    const open = engine.getState().openNote;
    if (
      reopen !== null &&
      open?.kind === "missing" &&
      notePathEquals(open.path, reopen)
    ) {
      void engine.openNote(reopen);
    }
  }

  function handleDeleteConfirm(): void {
    if (dialog.kind !== "delete") return;
    const path = dialog.node.path;
    const affectsOpenNote =
      openPath !== null &&
      isAtOrWithin(openPath, path);
    const name = dialog.node.name;
    const result = engine.delete(path);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    closeDialog();
    const { trashEntryId } = result;
    const reopen = affectsOpenNote ? openPath : null;
    if (trashEntryId !== undefined) {
      trashMessages = [
        {
          id: ++nextMessageId,
          text: describeMovedToTrash(name),
          durationMs: UNDO_TOAST_MS,
          action: {
            label: "Undo",
            run: () =>
              handleUndoTrash(trashEntryId, reopen),
          },
        },
      ];
    } else {
      trashMessages = [];
    }
    if (affectsOpenNote) {
      mobileView = "tree";
    }
  }
</script>

<div class="shell">
  <aside class="sidebar" class:mobile-hidden={mobileView !== "tree"}>
    <div class="tree-header">
      <Wordmark />
      <div class="tree-header-actions">
        <button
          type="button"
          class="button button-icon button-ghost"
          aria-label="New note"
          disabled={tree === null}
          onclick={handleHeaderNewNote}
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {#each actionIcons["new-note"] as d (d)}
              <path {d} />
            {/each}
          </svg>
        </button>
        <button
          type="button"
          class="button button-icon button-ghost"
          aria-label="New folder"
          disabled={tree === null}
          onclick={handleHeaderNewFolder}
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {#each actionIcons["new-folder"] as d (d)}
              <path {d} />
            {/each}
          </svg>
        </button>
        <RefreshButton {refreshing} onRefresh={handleRefresh} />
        <CommandMenu {commands} />
      </div>
    </div>
    {#if tree === null && engineState.refresh.lastError !== null}
      <p role="alert" class="alert-error">
        {describeSyncError(engineState.refresh.lastError, forgeName)}
      </p>
    {/if}
    <NoteTree
      {tree}
      loading={treeLoading}
      {selectedPath}
      syncStates={engineState.syncStates}
      {expandRequest}
      conflicts={conflictPaths}
      onSelect={handleSelect}
      onPlace={handlePlace}
      {noteDropArea}
      onDropOpen={handleDropOpen}
      onAction={handleTreeAction}
      onNewNote={handleHeaderNewNote}
    />
    {#if (engineState.synced?.undecryptableFiles ?? 0) > 0}
      <p class="field-hint hidden-files" role="note">
        {describeUndecryptableFiles(engineState.synced?.undecryptableFiles ?? 0)}
      </p>
    {/if}
    {#if trashEntries.length > 0}
      <div class="trash-slot">
        <button
          type="button"
          class="trash-row"
          data-testid="open-trash"
          onclick={openTrash}
        >
          <svg class="icon trash-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {#each actionIcons.delete as d (d)}
              <path {d} />
            {/each}
          </svg>
          <span class="trash-label">Trash</span>
          <span class="trash-count">({trashEntries.length})</span>
        </button>
      </div>
    {/if}
    <div class="sidebar-footer">
      <a
        class="repo-link"
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={repoLabelTruncated ? repoLabel : undefined}
      >
        <span class="repo-label" bind:this={repoLabelEl}>{repoLabel}</span>
        {#if head !== null}
          <CommitSha sha={head} />
        {/if}
      </a>
      <SettingsSaveIndicator state={settingsSave} onOpen={openSettings} />
      <button
        type="button"
        class="button button-icon button-ghost log-out"
        aria-label="Log out"
        title="Log out"
        onclick={handleLogOut}
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {#each commandIcons.logOut as d (d)}
            <path {d} />
          {/each}
        </svg>
      </button>
    </div>
  </aside>

  <section
    class="note-pane"
    class:mobile-hidden={mobileView !== "note"}
    bind:this={notePaneEl}
  >
    {#key draftSession}
      {#if draft !== null}
        <NoteHeader
          name={draft.name}
          draft={true}
          syncState={null}
          nameError={draftError}
          nameReadOnly={false}
          {nameResetKey}
          onNameCommit={handleNameCommit}
          onNameEscape={handleNameEscape}
          onNameEnterDone={handleNameEnterDone}
          onNameInput={handleDraftNameInput}
          onBack={handleBack}
        />
      {:else if engineState.openNote !== null}
        <NoteHeader
          name={noteName(engineState.openNote.path)}
          draft={false}
          syncState={engineState.syncStates.stateOf(engineState.openNote.path)}
          {nameError}
          nameReadOnly={openConflicted}
          {nameResetKey}
          namePendingText={pendingFieldText}
          onNamePendingConsumed={() => (pendingFieldText = null)}
          onNameCommit={handleNameCommit}
          onNameEscape={handleNameEscape}
          onNameEnterDone={handleNameEnterDone}
          onBack={handleBack}
          onHistory={() => void openHistory()}
          historyDisabled={engineState.openNote.kind === "missing" ||
            engineState.openNote.kind === "failed"}
        />
      {/if}
    {/key}
    <NotePane
      bind:this={notePane}
      {engine}
      {forgeName}
      openNote={engineState.openNote}
      draft={draft !== null}
      {noteDates}
      treeLoaded={tree !== null}
      hasNotes={tree !== null && tree.root.children.length > 0}
      onDraftContent={handleDraftContent}
      onNewNote={handleHeaderNewNote}
      noteFont={settings.noteFont}
    />
  </section>
</div>

<NoticeToasts
  notices={engineState.notices}
  messages={[
    ...refreshMessages,
    ...exportMessages,
    ...trashMessages,
    ...placeMessages,
    ...importMessages,
    ...historyMessages,
    ...sessionMessages,
  ]}
  onDismiss={(id) => engine.dismissNotice(id)}
  onDismissMessage={dismissMessage}
  onOpen={handleSelect}
/>

{#if dialog.kind === "createFolder"}
  <NameDialog
    title="New folder"
    label="Folder name"
    initialName=""
    siblingNames={dialog.siblingNames}
    submitLabel="Create"
    error={dialog.error}
    onSubmit={handleCreateFolderSubmit}
    onClose={closeDialog}
  />
{:else if dialog.kind === "rename"}
  <NameDialog
    title="Rename folder"
    label="Folder name"
    initialName={dialog.node.name}
    siblingNames={dialog.siblingNames}
    submitLabel="Rename"
    error={dialog.error}
    onSubmit={handleRenameSubmit}
    onClose={closeDialog}
  />
{:else if dialog.kind === "move" && tree !== null}
  <MoveDialog
    itemName={dialog.node.name}
    itemPath={dialog.node.path}
    itemKind={dialog.node.kind}
    tree={tree}
    error={dialog.error}
    onSubmit={handleMoveSubmit}
    onClose={closeDialog}
  />
{:else if dialog.kind === "delete"}
  <DeleteDialog
    itemName={dialog.node.name}
    itemKind={dialog.node.kind}
    itemCount={dialog.itemCount}
    error={dialog.error}
    onConfirm={handleDeleteConfirm}
    onClose={closeDialog}
  />
{/if}

<input
  bind:this={importInput}
  type="file"
  accept=".zip,application/zip"
  class="visually-hidden"
  tabindex="-1"
  aria-hidden="true"
  data-testid="import-file"
  onchange={(event) => void handleImportFile(event)}
/>

{#if importDialog !== null && tree !== null}
  <ImportDialog
    fileName={importDialog.fileName}
    contents={importDialog.contents}
    {tree}
    {forgeName}
    onEnableAtomic={handleEnableAtomic}
    onImport={handleImport}
    onClose={() => (importDialog = null)}
  />
{/if}

{#if atomicBlockedOpen && engineState.atomicBlocked !== null}
  <AtomicBlockedDialog
    {forgeName}
    canConfigure={engineState.atomicBlocked.canConfigure}
    onEnable={handleEnableAtomic}
    onSaveWithoutAtomic={() => engine.saveImportWithoutAtomic()}
    onClose={() => (atomicBlockedOpen = false)}
  />
{/if}

{#if settingsOpen}
  <SettingsDialog
    {settings}
    {changeSettings}
    saveState={settingsSave}
    onRetry={() => engine.retryNow()}
    onClose={() => {
      settingsSaver.flush();
      settingsOpen = false;
    }}
  />
{/if}

{#if changePassphraseOpen}
  <ChangePassphraseDialog
    {forgeName}
    repositoryLabel={repoLabel}
    change={passphraseChange}
    onChanged={onPassphraseChanged}
    onLogOut={handleLogOut}
    onClose={() => (changePassphraseOpen = false)}
  />
{/if}

{#if historyDialog !== null}
  <NoteHistoryDialog
    phase={historyDialog.phase}
    {noteHistory}
    current={historyCurrent}
    currentName={noteName(historyDialog.path)}
    {forgeName}
    conflicted={openConflicted}
    canSave={engineState.stopped === null && !engineState.suspended}
    onRestore={handleHistoryRestore}
    onRetryPrepare={() => void openHistory()}
    onClose={() => (historyDialog = null)}
  />
{/if}

<TrashDialog
  open={trashOpen}
  entries={trashEntries}
  now={trashNow}
  onRestore={(entry, node) =>
    (trashDialog = { kind: "restore", entry, node, error: null })}
  onDelete={(entry) => (trashDialog = { kind: "deleteEntry", entry })}
  onEmpty={() => (trashDialog = { kind: "empty" })}
  onClose={() => (trashOpen = false)}
/>

{#if trashDialog.kind === "restore" && tree !== null}
  <MoveDialog
    restore={true}
    itemName={trashDialog.node.name}
    itemPath={null}
    itemKind={trashDialog.node.kind}
    {tree}
    error={trashDialog.error}
    onSubmit={handleTrashRestoreSubmit}
    onClose={closeTrashDialog}
  />
{:else if trashDialog.kind === "deleteEntry"}
  <ConfirmDialog
    title="Delete permanently?"
    body="This can't be undone."
    confirmLabel="Delete permanently"
    onConfirm={handleTrashDeleteConfirm}
    onClose={closeTrashDialog}
  />
{:else if trashDialog.kind === "empty"}
  <ConfirmDialog
    title="Empty trash?"
    body={describeEmptyTrash(trashEntries.length)}
    confirmLabel="Empty trash"
    onConfirm={handleTrashDeleteConfirm}
    onClose={closeTrashDialog}
  />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  .sidebar,
  .note-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .mobile-hidden {
    display: none;
  }

  .note-pane {
    position: relative;
  }

  .note-pane::after {
    content: "";
    position: absolute;
    inset: var(--space-2);
    z-index: 1;
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-accent) 5%, transparent);
    box-shadow: inset 0 0 0 1.5px
      color-mix(in srgb, var(--color-accent) 55%, transparent);
    opacity: 0;
    scale: 0.985;
    pointer-events: none;
    transition:
      opacity 200ms var(--motion-easing),
      scale 200ms var(--motion-easing);
  }

  .note-pane:global([data-note-drop])::after {
    opacity: 1;
    scale: 1;
  }

  @media (prefers-color-scheme: dark) {
    .note-pane::after {
      background: color-mix(in srgb, var(--color-accent) 9%, transparent);
      box-shadow: inset 0 0 0 1.5px
        color-mix(in srgb, var(--color-accent) 70%, transparent);
    }
  }

  .sidebar,
  .note-pane {
    overflow: hidden;
  }

  .sidebar {
    background: var(--color-background);
  }

  .tree-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: calc(var(--touch-target) + var(--space-2) * 2);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    justify-content: space-between;
    border-bottom: var(--hairline) solid var(--color-border);
  }

  .sidebar-footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
    border-top: var(--hairline) solid var(--color-border);
    flex-shrink: 0;
  }

  .hidden-files {
    flex-shrink: 0;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-top: var(--hairline) solid var(--color-border);
  }

  .trash-slot {
    flex-shrink: 0;
    padding: var(--space-1) 0;
    border-top: var(--hairline) solid var(--color-border);
  }

  .trash-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      color var(--motion-duration) var(--motion-easing);
  }

  .trash-row:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }

  .trash-row:focus-visible {
    outline-offset: -2px;
  }

  .trash-icon {
    flex-shrink: 0;
  }

  .trash-label {
    flex: 1;
    min-width: 0;
  }

  .trash-count {
    flex-shrink: 0;
    padding-right: var(--space-1);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }

  .repo-link {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    min-height: var(--touch-target);
    color: var(--color-text-muted);
    text-decoration: none;
    transition: color var(--motion-duration) var(--motion-easing);
  }

  .sidebar-footer:has(:global(.settings-save-indicator)) .repo-link :global(.commit-sha) {
    mask-image: linear-gradient(to right, #000 calc(100% - var(--space-4)), transparent);
  }

  .repo-link:hover {
    color: var(--color-text);
  }

  .repo-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }

  .repo-link:hover .repo-label {
    text-decoration: underline;
  }

  .log-out {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .log-out:hover:not(:disabled) {
    color: var(--color-text);
  }

  .tree-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .tree-header-actions :global(.button) {
    color: var(--color-text-muted);
  }

  .tree-header-actions :global(.button:hover:not(:disabled)) {
    color: var(--color-text);
  }

  .alert-error {
    margin: var(--space-2) var(--space-3) 0;
  }

  @media (min-width: 768px) {
    .shell {
      flex-direction: row;
      height: 100dvh;
    }

    .sidebar {
      width: var(--sidebar-width);
      flex-shrink: 0;
      background: var(--color-surface);
      border-right: var(--hairline) solid var(--color-border);
    }

    .note-pane {
      flex: 1;
    }

    /* The 300px sidebar can't fit the wordmark plus four 44px-wide buttons. */
    .tree-header-actions {
      gap: 0;
    }

    .tree-header-actions :global(.button-icon) {
      width: 36px;
      min-width: 36px;
    }

    .log-out {
      width: 36px;
      min-width: 36px;
    }

    .mobile-hidden {
      display: flex;
    }
  }
</style>
