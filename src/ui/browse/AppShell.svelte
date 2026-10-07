<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { isAtOrWithin, notePathEquals, parentPath } from "../../changes/change";
  import type { HeldConflict, SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import type { SettingsSaver } from "../../settings/settings-saver";
  import { systemClock } from "../../sync/clock";
  import { tabTitle } from "../../app/tab-title";
  import {
    createLastViewStore,
    removeLastView,
    type LastView,
  } from "../../app/last-view";
  import {
    applySettingsEdits,
    resolveSettings,
    SETTINGS_SCHEMA,
    type Settings,
  } from "../../settings/settings";
  import type { AccentColorId } from "../../settings/accent-palette";
  import type { ColorModeId } from "../../settings/color-mode";
  import type { NoteFont } from "../../settings/note-font";
  import type { NoteHistory, NoteVersion } from "../../history/note-history";
  import type { NoteDatesResolver } from "../../history/note-dates";
  import type { RestorePlan } from "../../history/plan-restore";
  import { validateName } from "../../tree/note-names";
  import { describeNameError } from "../dialogs/name-messages";
  import {
    describeRestoreBlock,
    describeRestored,
    UNSAVED_BEFORE_RESTORE_MESSAGE,
  } from "../history/history-messages";
  import {
    findWorkingFolder,
    findWorkingNode,
    type WorkingFolder,
  } from "../../sync/working-tree";
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
    type ImportPlan,
    type ImportSummary,
  } from "../../import/plan-import";
  import {
    readDroppedFiles,
    type DroppedFile,
    type DroppedNotes,
    type DropSkipCounts,
  } from "../../import/read-dropped-files";
  import {
    MAX_ARCHIVE_UNCOMPRESSED_BYTES,
    NotesArchiveError,
    readNotesArchive,
    type ArchiveImportEntry,
    type NotesArchiveContents,
  } from "../../import/read-notes-archive";
  import ImportDialog from "../import/ImportDialog.svelte";
  import AtomicBlockedDialog from "../import/AtomicBlockedDialog.svelte";
  import {
    describeArchiveError,
    describeAtomicSetup,
    describeEnableAtomicFailure,
    describeFileDropDone,
    describeImportDone,
    describeImportRefusal,
    describeNothingDropped,
    ENABLE_ATOMIC_LABEL,
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
  import type { ContentIndexer } from "../../search/content-indexer";
  import { createRecentNotes } from "../search/recent-notes";
  import SearchPalette from "../search/SearchPalette.svelte";
  import SearchTrigger from "../search/SearchTrigger.svelte";
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
  import { createNoteDatesView, type ShownNoteDates } from "../note/note-dates-view";
  import { derivePrintNote, type PrintNote } from "../print/print-note";
  import type { ToastMessage, ToastTone } from "../notices/notice-messages";
  import NoticeToasts from "../notices/NoticeToasts.svelte";
  import { toastHost } from "../notices/toast-host";
  import NoteHeader from "./NoteHeader.svelte";
  import NoteTree from "./NoteTree.svelte";
  import RefreshButton from "./RefreshButton.svelte";
  import SyncStatusButton from "./SyncStatusButton.svelte";
  import { listUnsavedNotes } from "../../sync/unsaved-notes";
  import SettingsSaveIndicator from "../settings/SettingsSaveIndicator.svelte";
  import { settingsSaveState } from "../../settings/settings-save-state";
  import ShareDialog from "../share/ShareDialog.svelte";
  import SharedLinksDialog from "../share/SharedLinksDialog.svelte";
  import SharedVersionDialog from "../share/SharedVersionDialog.svelte";
  import { copyText } from "../share/copy-text";
  import {
    describeShareError,
    messageText,
    SHARE_UNCHANGED_TEXT,
    SHARE_UPDATED_TEXT,
  } from "../share/share-messages";
  import { MAX_SHARE_LABEL_LENGTH, normalizeShareLabel } from "../../share/share-label";
  import { shareNoteName } from "../share/share-row-title";
  import type { ShareService } from "../../share/share-service";
  import {
    sharesWithin,
    sharesOfNote,
    type ShareEntry,
  } from "../../share/share-index";
  import { sharedVersionShas } from "../../history/shared-versions";
  import { formatShareLink, shareLinkBase } from "../../share/share-link";
  import type { ForgeId } from "../../forge/repo-coordinates";
  import TrashDialog from "../trash/TrashDialog.svelte";
  import {
    describeEmptyTrash,
    describeUndoneFileDrop,
    describeMovedToTrash,
    describeRevokeFailed,
    describeUndoError,
  } from "../trash/trash-messages";
  import type { ReadableWorkingTrashEntry } from "../../sync/working-trash";
  import Wordmark from "../wordmark/Wordmark.svelte";
  import type { Command, RowAction } from "./row-menu-types";
  import type { ColorTag } from "../../tags/color-tag";
  import { buildTagFilter } from "./tag-filter";
  import TagFilterDots from "./TagFilterDots.svelte";
  import { describeMovedTo, describeStructureError } from "./structure-messages";
  import type { DropTarget } from "./tree-drop";
  import {
    DESKTOP_MEDIA_QUERY,
    isNarrowLayout,
  } from "./drag-motion";
  import { playViewSlide } from "../note/switch-motion-driver";
  import { trashReveal } from "./trash-reveal";
  import { createTreeExpansion } from "./tree-expansion.svelte";
  import { describeSyncError, describeUndecryptableFiles } from "./sync-messages";

  interface Props {
    engine: SyncEngine;
    settingsSaver: SettingsSaver;
    contentIndexer: ContentIndexer;
    repoLabel: string;
    repoUrl: string;
    forgeName: string;
    passphraseChange: PassphraseChange;
    noteHistory: NoteHistory;
    shareService: ShareService;
    forgeId: ForgeId;
    noteDatesResolver: NoteDatesResolver;
    keyring: Keyring;
    repoKey: string;
    sessionRemembered: boolean;
    initialMessage?: Pick<ToastMessage, "tone" | "text"> | null;
    onPassphraseChanged: (
      keyring: Keyring,
      check: LandedCheck,
      history: HistoryOutcome,
    ) => void;
    onLogOut: () => void;
    onAccentColor: (id: AccentColorId) => void;
    onColorMode: (id: ColorModeId) => void;
    onNoteFont: (id: NoteFont) => void;
    onPrintNote: (note: PrintNote | null) => void;
  }

  const {
    engine,
    settingsSaver,
    contentIndexer,
    repoLabel,
    repoUrl,
    forgeName,
    passphraseChange,
    noteHistory,
    shareService,
    forgeId,
    noteDatesResolver,
    keyring,
    repoKey,
    sessionRemembered,
    initialMessage = null,
    onPassphraseChanged,
    onLogOut,
    onAccentColor,
    onColorMode,
    onNoteFont,
    onPrintNote,
  }: Props = $props();

  let engineState = $state<SyncEngineState>(untrack(() => engine.getState()));
  const syncStatus = $derived(engineState.syncStates.stateOf([]));
  const offline = $derived(!engineState.online);
  const canRetry = $derived(
    engineState.online &&
      engineState.save.kind === "waiting" &&
      engineState.save.reason === "failed",
  );
  const unsavedNotes = $derived(
    engineState.workingTree === null
      ? { notes: [], others: engineState.syncStates.unsavedCount }
      : listUnsavedNotes({
          pending: engineState.pending,
          inFlight: engineState.inFlight,
          conflicts: engineState.conflicts.map((c) => c.path),
          tree: engineState.workingTree,
          unsavedCount: engineState.syncStates.unsavedCount,
        }),
  );
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
        readonly shareCount: number;
        readonly revoking: boolean;
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

  const linkBase = shareLinkBase(location);
  let sharedLinksOpen = $state(false);
  let sharePath = $state<NotePath | null>(null);
  let sharedVersionEntry = $state<ShareEntry | null>(null);
  let revokeEntry = $state<ShareEntry | null>(null);
  let renameShare = $state<{ readonly entry: ShareEntry; readonly error: string | null } | null>(
    null,
  );
  let trashOpen = $state(false);
  let trashNow = $state(Date.now());
  let trashDialog = $state<TrashDialogState>({ kind: "none" });
  let dialog = $state<DialogState>({ kind: "none" });
  let nameError = $state<string | null>(null);
  let nameResetKey = $state(0);
  const treeExpansion = createTreeExpansion();
  const lastViewStore = untrack(() => {
    if (!sessionRemembered) removeLastView(repoKey);
    return createLastViewStore({ repoKey, keyring });
  });
  onDestroy(() => lastViewStore.dispose());
  let reopenLastView = $state(
    untrack(() => sessionRemembered && lastViewStore.isEnabled()),
  );
  let expandRequest = $state<{ readonly path: NotePath } | null>(null);
  let draft = $state<NoteDraft | null>(null);
  let draftError = $state<string | null>(null);
  let draftSession = $state(0);
  let noteSwitch = $state(0);
  const headerSwitch = { seen: untrack(() => noteSwitch) };
  let pendingFieldText = $state<string | null>(null);
  let focusEditorOnEnter = false;
  let notePane: ReturnType<typeof NotePane> | undefined = $state();
  let notePaneEl: HTMLElement | undefined = $state();
  let sidebarEl: HTMLElement | undefined = $state();
  let shownMobileView = untrack(() => mobileView);

  $effect(() => {
    const view = mobileView;
    if (view === shownMobileView) return;
    shownMobileView = view;
    if (!isNarrowLayout()) return;
    const incoming = view === "note" ? notePaneEl : sidebarEl;
    if (incoming !== undefined) {
      playViewSlide(incoming, view === "note" ? "forward" : "back");
    }
  });
  type ToastChannel =
    | "refresh"
    | "export"
    | "trash"
    | "place"
    | "tag"
    | "share"
    | "import"
    | "history"
    | "session";
  const TOAST_ORDER = [
    "refresh",
    "export",
    "trash",
    "place",
    "tag",
    "share",
    "import",
    "history",
    "session",
  ] as const satisfies readonly ToastChannel[];
  let toasts = $state<Partial<Record<ToastChannel, ToastMessage>>>(
    untrack(() =>
      initialMessage === null
        ? {}
        : { session: { id: -1, ...initialMessage } },
    ),
  );
  let nextMessageId = 0;
  let exporting = $state(false);
  const UNDO_TOAST_MS = 8_000;
  let importInput: HTMLInputElement | undefined = $state();
  let reading = $state(false);
  let importDialog = $state<{
    readonly fileName: string;
    readonly contents: NotesArchiveContents;
  } | null>(null);
  let importStarted = $state<{
    readonly summary: ImportSummary;
    retryingShown: boolean;
    readonly fileDrop?: {
      readonly paths: readonly NotePath[];
      readonly skipped: DropSkipCounts;
    };
  } | null>(null);
  let atomicBlockedOpen = $state(false);
  let changePassphraseOpen = $state(false);
  let settingsOpen = $state(false);
  let searchOpen = $state(false);
  let searchReturnFocus: HTMLElement | null = null;

  function openSearch(): void {
    searchReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchOpen = true;
  }

  async function closeSearch(): Promise<void> {
    searchOpen = false;
    await tick();
    if (searchReturnFocus?.isConnected) searchReturnFocus.focus();
  }

  async function revealAndOpen(path: NotePath): Promise<void> {
    if (path.length > 1) expandFolder(parentPath(path));
    await handleSelect(path);
  }

  async function openSearchResult(path: NotePath): Promise<void> {
    searchOpen = false;
    await revealAndOpen(path);
    await tick();
    if (
      !isNarrowLayout() &&
      selectedPath !== null &&
      notePathEquals(selectedPath, path)
    ) {
      notePane?.focusEditor();
    }
  }

  let historyDialog = $state<{
    readonly path: NotePath;
    readonly phase: HistoryPhase;
  } | null>(null);
  interface UndoGuard {
    readonly id: number;
    readonly path: NotePath;
    readonly content: string;
  }
  let undoGuard = $state<UndoGuard | null>(null);

  function showToast(
    channel: ToastChannel,
    tone: ToastTone,
    text: string,
    extra?: Omit<ToastMessage, "id" | "tone" | "text">,
  ): number {
    const id = ++nextMessageId;
    toasts[channel] = { id, tone, text, ...extra };
    return id;
  }

  function clearToast(channel: ToastChannel, id?: number): void {
    if (id === undefined || toasts[channel]?.id === id) delete toasts[channel];
  }

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

  $effect(() => {
    tabTitle.setUnsaved(
      engineState.syncStates.hasUnsaved || Object.keys(pendingSettingsEdits).length > 0,
    );
    return () => tabTitle.setUnsaved(false);
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
    if (engineState.synced !== null || pendingSettingsEdits.colorMode !== undefined)
      onColorMode(settings.colorMode);
  });

  $effect(() => {
    onNoteFont(settings.noteFont);
  });

  const openPath = $derived(engineState.openNote?.path ?? null);
  const openConflict = $derived<HeldConflict | undefined>(
    openPath === null
      ? undefined
      : engineState.conflicts.find((held) => notePathEquals(held.path, openPath)),
  );
  const openConflicted = $derived(openConflict !== undefined);

  const printNote = $derived(
    derivePrintNote(draft, engineState.openNote, openConflict ? [openConflict] : []),
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
  let tagFilter = $state<ColorTag | null>(null);
  const tagFilterView = $derived(
    tree === null ? null : buildTagFilter(tree, tagFilter),
  );
  const tagsWritable = $derived(engineState.synced?.tags.writable ?? false);
  const usedTags = $derived(tagFilterView?.usedTags ?? []);

  $effect(() => {
    if (tagFilter !== null && (!tagsWritable || !usedTags.includes(tagFilter))) {
      tagFilter = null;
    }
  });

  function toggleTagFilter(tag: ColorTag): void {
    tagFilter = tagFilter === tag ? null : tag;
  }
  const openTreeNote = $derived.by(() => {
    if (openPath === null || tree === null) return undefined;
    const node = findWorkingNode(tree, openPath);
    return node?.kind === "note" ? node : undefined;
  });
  const treeLoading = $derived(engineState.synced === null && engineState.refresh.inFlight);
  const trashEntries = $derived(engineState.visibleTrash ?? []);
  const selectedPath = $derived(engineState.openNote?.path ?? null);

  function currentLastView(): LastView {
    const kind = engineState.openNote?.kind;
    const note = kind === "loaded" || kind === "loading" ? openPath : null;
    const folders =
      tree === null
        ? []
        : treeExpansion
            .expandedPaths()
            .filter((path) => findWorkingFolder(tree, path) !== undefined);
    return { note, folders };
  }

  function handleReopenLastViewChange(on: boolean): void {
    if (!sessionRemembered) return;
    lastViewStore.setEnabled(on, currentLastView());
    reopenLastView = on;
  }

  function openRestoredNote(path: NotePath): Promise<void> {
    return revealAndOpen(path);
  }

  async function restoreLastView(): Promise<void> {
    if (!sessionRemembered || !reopenLastView) return;
    const view = await lastViewStore.load();
    const current = tree;
    if (view === null || current === null) return;
    for (const folder of view.folders) {
      if (findWorkingFolder(current, folder) !== undefined) {
        treeExpansion.setExpanded(folder, true);
      }
    }
    const note = view.note;
    if (
      note !== null &&
      findWorkingNode(current, note)?.kind === "note" &&
      engineState.openNote === null &&
      draft === null
    ) {
      await openRestoredNote(note);
    }
  }

  let restoreStarted = false;
  let lastViewRestored = false;
  $effect(() => {
    if (tree === null || restoreStarted) return;
    restoreStarted = true;
    void untrack(restoreLastView)
      .catch(() => {})
      .finally(() => {
        lastViewRestored = true;
        saveLastView();
      });
  });

  function saveLastView(): void {
    if (lastViewRestored && reopenLastView && sessionRemembered) {
      lastViewStore.save(currentLastView());
    }
  }

  $effect(() => {
    currentLastView();
    saveLastView();
  });
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
      id: "shared-links",
      label: "Shared links",
      icon: commandIcons.sharedLinks,
      disabled: tree === null || engineState.stopped !== null || importing,
      run: () => {
        settingsSaver.flush();
        leaveDraft();
        sharedLinksOpen = true;
      },
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


  const NOTE_DATES_DEBOUNCE_MS = 3000;

  let shownDates = $state<ShownNoteDates | null>(null);
  const noteDatesView = createNoteDatesView({
    // Reads the prop on every call: a passphrase change swaps the resolver
    // without remounting the shell.
    resolver: {
      cached: (path) => noteDatesResolver.cached(path),
      forget: (path) => noteDatesResolver.forget(path),
      resolve: (path, head, blobSha) => noteDatesResolver.resolve(path, head, blobSha),
    },
    clock: systemClock,
    debounceMs: NOTE_DATES_DEBOUNCE_MS,
    onShow: (shown) => {
      shownDates = shown;
    },
  });

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
    const state = untrack(() => engine.getState());
    return noteDatesView.update({
      key: loadedKey,
      noteSwitch: untrack(() => noteSwitch),
      blobSha: loadedBlobSha,
      idle: saveIdle,
      headHasOpenNote,
      open: state.openNote,
      head: state.synced?.head,
    });
  });

  const historySharedShas = $derived(
    historyDialog === null || engineState.shares === null
      ? new Set<string>()
      : sharedVersionShas(sharesOfNote(engineState.shares, historyDialog.path)),
  );

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
    const id = showToast(
      "history",
      "success",
      describeRestored(version.committedAt, Date.now()),
      {
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
    );
    undoGuard =
      restored?.kind === "loaded"
        ? { id, path: restored.path, content: restored.content }
        : null;
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
    clearToast("history", id);
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
    if (result.ok) clearToast("history");
    else showToast("history", "error", result.message);
  }

  $effect(() => {
    if (trashOpen && trashEntries.length === 0) {
      trashOpen = false;
      trashDialog = { kind: "none" };
    }
  });

  const recentNotes = createRecentNotes();
  let recentPaths = $state.raw<readonly NotePath[]>([]);
  $effect(() => {
    const path = openPath;
    untrack(() => {
      if (path !== null) recentNotes.record(path);
      recentPaths = recentNotes.list(path);
    });
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

  let shareSyncedPath: NotePath | null = null;

  function openShareDialog(path: NotePath, syncedPath: NotePath | null): void {
    sharePath = path;
    shareSyncedPath = syncedPath;
  }

  function findBySyncedPath(
    folder: WorkingFolder,
    syncedPath: NotePath,
  ): WorkingNode | undefined {
    for (const child of folder.children) {
      if (child.kind === "folder") {
        const found = findBySyncedPath(child, syncedPath);
        if (found !== undefined) return found;
      } else if (
        child.syncedPath !== null &&
        notePathEquals(child.syncedPath, syncedPath)
      ) {
        return child;
      }
    }
    return undefined;
  }

  $effect(() => {
    const path = sharePath;
    if (path === null || tree === null) return;
    const current = findWorkingNode(tree, path);
    const note =
      current?.kind === "note"
        ? current
        : shareSyncedPath === null
          ? undefined
          : findBySyncedPath(tree.root, shareSyncedPath);
    if (note?.kind !== "note") {
      sharePath = null;
      return;
    }
    shareSyncedPath = note.syncedPath;
    if (!notePathEquals(note.path, path)) sharePath = note.path;
  });

  function noteName(path: NotePath): string {
    return path[path.length - 1];
  }

  function handleSelect(path: NotePath): Promise<void> {
    const open = engineState.openNote;
    if (
      draft === null &&
      selectedPath !== null &&
      notePathEquals(path, selectedPath) &&
      (open?.kind === "loaded" || open?.kind === "loading")
    ) {
      mobileView = "note";
      return Promise.resolve();
    }
    leaveDraft();
    mobileView = "note";
    noteSwitch += 1;
    return engine.openNote(path);
  }

  // On narrow screens the tree and the note pane are never shown together.
  function noteDropArea(): HTMLElement | null {
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
      ? (notePaneEl ?? null)
      : null;
  }

  function handleDropOpen(path: NotePath): void {
    void handleSelect(path);
  }

  let trashButtonEl = $state<HTMLButtonElement | null>(null);
  let treeDragActive = $state(false);

  function trashDropArea(): HTMLElement | null {
    return trashButtonEl;
  }

  function handleDropTrash(path: NotePath): void {
    const node = tree === null ? undefined : findWorkingNode(tree, path);
    if (node) requestTrash(node);
  }

  function handleTreeDragState(active: boolean): void {
    treeDragActive = active;
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
    tagFilter = null;
    leaveDraft();
    noteSwitch += 1;
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
        tagFilter = null;
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
    tagFilter = null;
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
    showToast("refresh", "error", text);
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
      clearToast("refresh");
      return true;
    }
    showRefreshError(describeSyncError(error, forgeName));
    return false;
  }

  async function handleExport(): Promise<void> {
    const snapshot = engine.snapshotNotes();
    if (snapshot === null || exporting) return;
    exporting = true;
    clearToast("export");
    try {
      await downloadNotesArchive(snapshot);
    } catch {
      showToast("export", "error", "Export failed. Try again later.");
    } finally {
      exporting = false;
    }
  }

  function showImportMessage(tone: ToastTone, text: string): void {
    showToast("import", tone, text);
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
      const { fileDrop } = started;
      if (fileDrop === undefined) {
        showImportMessage(
          "success",
          describeImportDone(started.summary.notes, started.summary.folders),
        );
      } else {
        showToast(
          "import",
          "success",
          describeFileDropDone(fileDrop.paths.length, fileDrop.skipped),
          {
            durationMs: UNDO_TOAST_MS,
            action: { label: "Undo", run: () => undoFileDrop(fileDrop.paths) },
          },
        );
      }
      return;
    }
    if (
      !started.retryingShown &&
      engineState.atomicBlocked === null &&
      save.kind === "waiting" &&
      save.reason === "failed"
    ) {
      started.retryingShown = true;
      showImportMessage("warning", IMPORT_RETRYING_MESSAGE);
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
    clearToast("import");
    if (file.size > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      showImportMessage("error", describeArchiveError("tooLarge"));
      return;
    }
    reading = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      importDialog = { fileName: file.name, contents: readNotesArchive(bytes) };
    } catch (error) {
      showImportMessage(
        "error",
        describeArchiveError(
          error instanceof NotesArchiveError ? error.kind : "invalidArchive",
        ),
      );
    } finally {
      reading = false;
    }
  }

  async function commitImport(
    destination: ImportDestination,
    entries: readonly ArchiveImportEntry[],
    policy: CollisionPolicy,
    onQueued: (plan: Extract<ImportPlan, { ok: true }>) => void,
  ): Promise<ImportOutcome> {
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
        plan = planImport(current, destination, entries, policy);
      } catch {
        return {
          kind: "error",
          message: "The destination folder no longer exists.",
        };
      }
      if (!plan.ok) return { kind: "conflicts", count: plan.conflicts };
      const result = await engine.importChanges(plan.changes);
      if (result.ok) {
        onQueued(plan);
        return { kind: "queued" };
      }
      if (result.reason !== "outdated") {
        return { kind: "error", message: describeImportRefusal(result.reason) };
      }
    }
    return { kind: "error", message: describeImportRefusal("outdated") };
  }

  async function handleImport(
    destination: ImportDestination,
    policy: CollisionPolicy,
  ): Promise<ImportOutcome> {
    const pending = importDialog;
    if (pending === null) return { kind: "error", message: describeImportRefusal("unavailable") };
    return commitImport(destination, pending.contents.entries, policy, (plan) => {
      tagFilter = null;
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
    });
  }

  let droppingFiles = false;

  async function handleFileDrop(
    files: readonly DroppedFile[],
    destination: ImportDestination,
  ): Promise<void> {
    if (droppingFiles || importing) return;
    clearToast("import");
    droppingFiles = true;
    try {
      const { entries, skipped } = await readDroppedFiles(files);
      if (entries.length === 0) {
        showImportMessage("warning", describeNothingDropped(skipped));
        return;
      }
      await importDroppedNotes(entries, skipped, destination);
    } finally {
      droppingFiles = false;
    }
  }

  async function importDroppedNotes(
    entries: DroppedNotes["entries"],
    skipped: DropSkipCounts,
    destination: ImportDestination,
  ): Promise<void> {
    const outcome = await commitImport(destination, entries, "rename", (plan) => {
      tagFilter = null;
      if (destination.kind === "folder") expandFolder(destination.path);
      const paths = plan.changes.flatMap((change) =>
        change.kind === "create-note" ? [change.path] : [],
      );
      importStarted = {
        summary: plan.summary,
        retryingShown: false,
        fileDrop: { paths, skipped },
      };
    });
    if (outcome.kind === "needsSetup") {
      showToast(
        "import",
        "error",
        describeAtomicSetup(forgeName, outcome.canConfigure),
        outcome.canConfigure
          ? {
              action: {
                label: ENABLE_ATOMIC_LABEL,
                run: () => void enableAtomicAndDrop(entries, skipped, destination),
              },
            }
          : undefined,
      );
    } else if (outcome.kind === "error") {
      showImportMessage("error", outcome.message);
    }
  }

  async function enableAtomicAndDrop(
    entries: DroppedNotes["entries"],
    skipped: DropSkipCounts,
    destination: ImportDestination,
  ): Promise<void> {
    if (droppingFiles || importing) return;
    droppingFiles = true;
    try {
      const failure = await handleEnableAtomic();
      if (failure !== null) {
        showImportMessage("error", failure);
        return;
      }
      await importDroppedNotes(entries, skipped, destination);
    } finally {
      droppingFiles = false;
    }
  }

  function undoFileDrop(paths: readonly NotePath[]): void {
    let trashed = 0;
    let kept = 0;
    let affectsOpenNote = false;
    for (const path of paths) {
      const current = engine.getState().workingTree;
      if (current === null || findWorkingNode(current, path)?.kind !== "note") continue;
      if (shareCountWithin(path) > 0) {
        kept++;
        continue;
      }
      const open = openPath;
      if (!engine.delete(path).ok) continue;
      trashed++;
      if (open !== null && notePathEquals(open, path)) affectsOpenNote = true;
    }
    if (trashed > 0 || kept > 0) {
      showToast("trash", "success", describeUndoneFileDrop(trashed, kept));
    }
    if (affectsOpenNote) mobileView = "tree";
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
      case "share":
        if (node.kind === "note") openShareDialog(node.path, node.syncedPath);
        break;
      case "move":
        dialog = { kind: "move", node, error: null };
        break;
      case "delete":
        requestTrash(node);
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
    tagFilter = null;
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
    const siblings = siblingNamesOf(from);
    const previousBefore = siblings[siblings.indexOf(name) + 1] ?? null;

    const result = engine.place(path, target);
    if (!result.ok) {
      showToast("place", "error", describeStructureError(result.error));
      return null;
    }
    const placed = result.path;
    if (notePathEquals(from, target.parent)) {
      clearToast("place");
    } else {
      showToast("place", "success", describeMovedTo(name, target.parent), {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          run: () =>
            handleUndoPlace(placed, { parent: from, before: previousBefore }),
        },
      });
    }
    return placed;
  }

  function handleColorTag(path: NotePath, color: ColorTag | null): void {
    const result = engine.setColorTag(path, color);
    if (!result.ok) showToast("tag", "error", describeStructureError(result.error));
  }

  function handleUndoPlace(path: NotePath, target: DropTarget): void {
    const result = engine.place(path, target);
    if (result.ok) clearToast("place");
    else showToast("place", "error", describeStructureError(result.error));
  }

  function dismissMessage(id: number): void {
    for (const channel of TOAST_ORDER) clearToast(channel, id);
  }

  async function copyShareText(text: string, copied: string): Promise<boolean> {
    const ok = await copyText(text);
    if (ok) showToast("share", "success", copied);
    else showToast("share", "error", "Couldn't copy. Select the text and copy it.");
    return ok;
  }

  function handleOpenSharedNote(entry: ShareEntry): void {
    if (entry.note.state !== "active") return;
    sharedLinksOpen = false;
    void handleSelect(entry.note.path);
  }

  let updatingShareId = $state<string | null>(null);

  async function handleUpdateShare(entry: ShareEntry): Promise<void> {
    if (updatingShareId !== null) return;
    updatingShareId = entry.id;
    try {
      const result = await shareService.updateShare(entry.id);
      if (!result.ok) {
        showToast("share", "error", messageText(describeShareError(result.error, forgeId)));
      } else {
        showToast(
          "share",
          result.unchanged ? "info" : "success",
          result.unchanged ? SHARE_UNCHANGED_TEXT : SHARE_UPDATED_TEXT,
        );
      }
    } finally {
      updatingShareId = null;
    }
  }

  function validateShareLabel(input: string): string | null {
    return normalizeShareLabel(input).ok
      ? null
      : messageText(describeShareError({ kind: "labelTooLong" }, forgeId));
  }

  function handleRenameShareSubmit(raw: string): void {
    if (renameShare === null) return;
    const { entry } = renameShare;
    const result = shareService.setShareLabel(entry.id, raw);
    if (result.ok) renameShare = null;
    else renameShare = { entry, error: messageText(describeShareError(result.error, forgeId)) };
  }

  async function handleRevokeConfirm(): Promise<void> {
    if (revokeEntry === null) return;
    const { id } = revokeEntry;
    revokeEntry = null;
    const result = await shareService.revokeShare(id);
    if (result.ok) showToast("share", "success", "Link revoked");
    else showToast("share", "error", messageText(describeShareError(result.error, forgeId)));
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

  function shareCountWithin(path: NotePath): number {
    const shares = engine.getState().shares;
    return shares === null ? 0 : sharesWithin(shares, path).length;
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
      showToast("trash", "error", describeUndoError(result.error));
      return;
    }
    const open = engine.getState().openNote;
    if (
      reopen !== null &&
      open?.kind === "missing" &&
      notePathEquals(open.path, reopen)
    ) {
      noteSwitch += 1;
      void engine.openNote(reopen);
    }
  }

  function isConflictedWithin(path: NotePath): boolean {
    return engine
      .getState()
      .conflicts.some((held) => isAtOrWithin(held.path, path));
  }

  function requestTrash(node: WorkingNode): void {
    dialog = {
      kind: "delete",
      node,
      itemCount: node.kind === "folder" ? countDescendants(node) : 0,
      shareCount: shareCountWithin(node.path),
      revoking: false,
      error: null,
    };
  }

  // Shares are revoked before the item is trashed, so a failure leaves the
  // item in place and no trashed note keeps a live link.
  async function handleDeleteConfirm(): Promise<void> {
    if (dialog.kind !== "delete" || dialog.revoking) return;
    const current = dialog;
    const path = current.node.path;
    const shareCount = shareCountWithin(path);
    if (shareCount > 0) {
      if (current.shareCount === 0) {
        dialog = { ...current, shareCount };
        return;
      }
      if (isConflictedWithin(path)) {
        dialog = {
          ...current,
          shareCount,
          error: describeStructureError({ kind: "conflicted" }),
        };
        return;
      }
      dialog = { ...current, shareCount, revoking: true, error: null };
      const result = await shareService.revokeShares(path);
      if (dialog.kind !== "delete" || !notePathEquals(dialog.node.path, path)) {
        return;
      }
      const remaining = shareCountWithin(path);
      if (!result.ok) {
        dialog = {
          ...dialog,
          shareCount: remaining,
          revoking: false,
          error: describeRevokeFailed(
            messageText(describeShareError(result.error, forgeId)),
            result.revoked,
          ),
        };
        return;
      }
      if (remaining > 0) {
        dialog = { ...dialog, shareCount: remaining, revoking: false };
        return;
      }
    }
    trashItem(path, current.node.name);
  }

  function trashItem(path: NotePath, name: string): void {
    if (dialog.kind !== "delete") return;
    const affectsOpenNote =
      openPath !== null &&
      isAtOrWithin(openPath, path);
    const result = engine.delete(path);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    closeDialog();
    const { trashEntryId } = result;
    const reopen = affectsOpenNote ? openPath : null;
    if (trashEntryId !== undefined) {
      showToast("trash", "success", describeMovedToTrash(name), {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          run: () => handleUndoTrash(trashEntryId, reopen),
        },
      });
    } else {
      clearToast("trash");
    }
    if (affectsOpenNote) {
      mobileView = "tree";
    }
  }
</script>

<div class="shell">
  <aside
    class="sidebar"
    class:mobile-hidden={mobileView !== "tree"}
    bind:this={sidebarEl}
  >
    <div class="tree-header">
      <Wordmark />
      <div class="tree-header-actions">
        <SyncStatusButton
          state={syncStatus}
          {offline}
          hasUnsaved={engineState.syncStates.hasUnsaved}
          notes={unsavedNotes.notes}
          others={unsavedNotes.others}
          {canRetry}
          onOpenNote={(path) => void revealAndOpen(path)}
          onRetry={() => engine.retryNow()}
        />
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
    <SearchTrigger onOpen={openSearch} />
    {#if tagsWritable && usedTags.length > 0}
      <TagFilterDots tags={usedTags} active={tagFilter} onToggle={toggleTagFilter} />
    {/if}
    {#if tree === null && engineState.refresh.lastError !== null}
      <p role="alert" class="alert-error">
        {describeSyncError(engineState.refresh.lastError, forgeName)}
      </p>
    {/if}
    <NoteTree
      {tree}
      filteredTree={tagFilter === null || tagFilterView === null ? null : tagFilterView.tree}
      loading={treeLoading}
      {selectedPath}
      syncStates={engineState.syncStates}
      {expandRequest}
      expansion={treeExpansion}
      conflicts={conflictPaths}
      onSelect={handleSelect}
      onPlace={handlePlace}
      {noteDropArea}
      onDropOpen={handleDropOpen}
      {trashDropArea}
      onTrash={handleDropTrash}
      onDragStateChange={handleTreeDragState}
      onAction={handleTreeAction}
      {tagsWritable}
      onColorTag={handleColorTag}
      onNewNote={handleHeaderNewNote}
      onFileDrop={(files, destination) => void handleFileDrop(files, destination)}
    />
    {#if (engineState.synced?.undecryptableFiles ?? 0) > 0}
      <p class="field-hint hidden-files" role="note">
        {describeUndecryptableFiles(engineState.synced?.undecryptableFiles ?? 0)}
      </p>
    {/if}
    {#if trashEntries.length > 0 || treeDragActive}
      <div class="trash-slot" transition:trashReveal>
        <button
          bind:this={trashButtonEl}
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
          {#if trashEntries.length > 0}
            <span class="trash-count">({trashEntries.length})</span>
          {/if}
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
          {noteSwitch}
          seenSwitch={headerSwitch}
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
          {noteSwitch}
          seenSwitch={headerSwitch}
          namePendingText={pendingFieldText}
          onNamePendingConsumed={() => (pendingFieldText = null)}
          onNameCommit={handleNameCommit}
          onNameEscape={handleNameEscape}
          onNameEnterDone={handleNameEnterDone}
          onBack={handleBack}
          onHistory={() => void openHistory()}
          historyDisabled={engineState.openNote.kind === "missing" ||
            engineState.openNote.kind === "failed"}
          colorTag={openTreeNote?.colorTag ?? null}
          shared={openTreeNote?.shared ?? false}
          colorTagDisabled={!(engineState.synced?.tags.writable ?? false)}
          onShare={openTreeNote !== undefined && !openConflicted
            ? () => openShareDialog(openTreeNote.path, openTreeNote.syncedPath)
            : undefined}
          onColorTag={openTreeNote !== undefined && !openConflicted
            ? (color) => handleColorTag(openTreeNote.path, color)
            : undefined}
        />
      {/if}
    {/key}
    <NotePane
      bind:this={notePane}
      {engine}
      {forgeName}
      openNote={engineState.openNote}
      {noteSwitch}
      conflict={openConflict}
      draft={draft !== null}
      {noteDates}
      treeLoaded={tree !== null}
      hasNotes={tree !== null && tree.root.children.length > 0}
      onDraftContent={handleDraftContent}
      onNewNote={handleHeaderNewNote}
      noteFont={settings.noteFont}
      shared={openTreeNote?.shared ?? false}
      onShared={draft === null && openTreeNote !== undefined && !openConflicted
        ? () => openShareDialog(openTreeNote.path, openTreeNote.syncedPath)
        : undefined}
    />
  </section>
</div>

<div class="toast-host" use:toastHost>
  <NoticeToasts
    notices={engineState.notices}
    messages={TOAST_ORDER.flatMap((channel) => toasts[channel] ?? [])}
    onDismiss={(id) => engine.dismissNotice(id)}
    onDismissMessage={dismissMessage}
    onOpen={handleSelect}
  />
</div>

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
    shareCount={dialog.shareCount}
    revoking={dialog.revoking}
    error={dialog.error}
    onConfirm={() => void handleDeleteConfirm()}
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

{#if searchOpen}
  <SearchPalette
    indexer={contentIndexer}
    {forgeName}
    recent={recentPaths}
    onOpen={openSearchResult}
    onClose={closeSearch}
  />
{/if}

{#if settingsOpen}
  <SettingsDialog
    {settings}
    {changeSettings}
    saveState={settingsSave}
    device={{
      reopenLastView,
      remembered: sessionRemembered,
      onReopenLastViewChange: handleReopenLastViewChange,
    }}
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
    sharedShas={historySharedShas}
    {forgeName}
    conflicted={openConflicted}
    canSave={engineState.stopped === null && !engineState.suspended}
    onRestore={handleHistoryRestore}
    onRetryPrepare={() => void openHistory()}
    onClose={() => (historyDialog = null)}
  />
{/if}

{#if sharePath !== null}
  <ShareDialog
    open={true}
    noteName={noteName(sharePath)}
    path={sharePath}
    shares={engineState.shares}
    {tree}
    {linkBase}
    {forgeId}
    {shareService}
    onCopyLink={(entry) =>
      void copyShareText(
        formatShareLink(linkBase, entry.locator, entry.linkSecret),
        "Link copied",
      )}
    onCopyPassword={(entry) =>
      void copyShareText(entry.password ?? "", "Password copied")}
    onCopyText={copyShareText}
    onViewVersion={(entry) => (sharedVersionEntry = entry)}
    updatingId={updatingShareId}
    onUpdate={(entry) => void handleUpdateShare(entry)}
    onRename={(entry) => (renameShare = { entry, error: null })}
    onRevoke={(entry) => (revokeEntry = entry)}
    onClose={() => (sharePath = null)}
  />
{/if}

<SharedLinksDialog
  open={sharedLinksOpen}
  shares={engineState.shares}
  {tree}
  {linkBase}
  onCopyLink={(entry) =>
    void copyShareText(
      formatShareLink(linkBase, entry.locator, entry.linkSecret),
      "Link copied",
    )}
  onCopyPassword={(entry) =>
    void copyShareText(entry.password ?? "", "Password copied")}
  onViewVersion={(entry) => (sharedVersionEntry = entry)}
  updatingId={updatingShareId}
  onUpdate={(entry) => void handleUpdateShare(entry)}
  onOpenNote={handleOpenSharedNote}
  onRename={(entry) => (renameShare = { entry, error: null })}
    onRevoke={(entry) => (revokeEntry = entry)}
  onClose={() => (sharedLinksOpen = false)}
/>

{#if sharedVersionEntry !== null}
  <SharedVersionDialog
    entry={sharedVersionEntry}
    {noteHistory}
    {forgeName}
    noteFont={settings.noteFont}
    onClose={() => (sharedVersionEntry = null)}
  />
{/if}

{#if renameShare !== null}
  <NameDialog
    title="Rename link"
    label="Name"
    submitLabel="Rename"
    initialName={renameShare.entry.label ?? ""}
    placeholder={shareNoteName(renameShare.entry)}
    maxLength={MAX_SHARE_LABEL_LENGTH}
    validate={validateShareLabel}
    error={renameShare.error}
    onSubmit={handleRenameShareSubmit}
    onClose={() => (renameShare = null)}
  />
{/if}

{#if revokeEntry !== null}
  <ConfirmDialog
    title="Revoke link?"
    body="The link will stop working. People who already opened it may have kept a copy."
    confirmLabel="Revoke"
    onConfirm={() => void handleRevokeConfirm()}
    onClose={() => (revokeEntry = null)}
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
  .toast-host {
    display: contents;
  }

  .toast-host:global([data-moving]) :global(.toast),
  .toast-host:global([data-moving]) :global(.toast *) {
    transition: none;
  }

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
    background: light-dark(
      color-mix(in srgb, var(--color-accent) 5%, transparent),
      color-mix(in srgb, var(--color-accent) 9%, transparent)
    );
    box-shadow: inset 0 0 0 1.5px
      light-dark(
        color-mix(in srgb, var(--color-accent) 55%, transparent),
        color-mix(in srgb, var(--color-accent) 70%, transparent)
      );
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
      background-color 200ms var(--motion-easing),
      color 200ms var(--motion-easing),
      box-shadow 200ms var(--motion-easing);
  }

  .trash-row:hover {
    background: var(--color-hover);
    color: var(--color-text);
  }

  .trash-row:global([data-trash-drop]) {
    background: light-dark(
      color-mix(in srgb, var(--color-accent) 16%, transparent),
      color-mix(in srgb, var(--color-accent) 22%, transparent)
    );
    color: var(--color-text);
    box-shadow: inset 0 0 0 1.5px
      color-mix(in srgb, var(--color-accent) 70%, transparent);
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

    /* The 300px sidebar can't fit the wordmark plus five 36px-wide buttons. */
    .tree-header {
      gap: 0;
      padding-right: var(--space-1);
    }

    .tree-header :global(.wordmark) {
      font-size: var(--font-size-base);
    }

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
