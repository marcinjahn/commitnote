<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { isWithinFolder, notePathEquals, parentPath } from "../../changes/change";
  import type { SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import { findWorkingNode } from "../../sync/working-tree";
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
    LandedCheck,
    PassphraseChange,
  } from "../../rekey/change-passphrase";
  import ChangePassphraseDialog from "../passphrase/ChangePassphraseDialog.svelte";
  import DeleteDialog from "../dialogs/DeleteDialog.svelte";
  import { actionIcons, commandIcons } from "./action-icons";
  import CommandMenu from "./CommandMenu.svelte";
  import { countDescendants } from "../dialogs/folder-options";
  import MoveDialog from "../dialogs/MoveDialog.svelte";
  import ConfirmDialog from "../dialogs/ConfirmDialog.svelte";
  import NameDialog from "../dialogs/NameDialog.svelte";
  import { decideNameCommit } from "../note/name-field-commit";
  import { resolveNoteDraft, type NoteDraft } from "../note/note-draft";
  import NotePane from "../note/NotePane.svelte";
  import type { ToastMessage } from "../notices/notice-messages";
  import NoticeToasts from "../notices/NoticeToasts.svelte";
  import NoteHeader from "./NoteHeader.svelte";
  import NoteTree from "./NoteTree.svelte";
  import RefreshButton from "./RefreshButton.svelte";
  import TrashDialog from "../trash/TrashDialog.svelte";
  import {
    describeEmptyTrash,
    describeMovedToTrash,
    describeUndoError,
  } from "../trash/trash-messages";
  import type { ReadableWorkingTrashEntry } from "../../sync/working-trash";
  import Wordmark from "../wordmark/Wordmark.svelte";
  import type { Command, RowAction } from "./row-menu-types";
  import { describeStructureError } from "./structure-messages";
  import { describeSyncError, describeUndecryptableFiles } from "./sync-messages";

  interface Props {
    engine: SyncEngine;
    repoLabel: string;
    repoUrl: string;
    forgeName: string;
    passphraseChange: PassphraseChange;
    initialMessage?: string | null;
    onPassphraseChanged: (keyring: Keyring, check: LandedCheck) => void;
    onLogOut: () => void;
  }

  const {
    engine,
    repoLabel,
    repoUrl,
    forgeName,
    passphraseChange,
    initialMessage = null,
    onPassphraseChanged,
    onLogOut,
  }: Props = $props();

  let engineState = $state<SyncEngineState>(untrack(() => engine.getState()));
  let mobileView = $state<"tree" | "note">("tree");
  let repoLabelEl = $state<HTMLAnchorElement | null>(null);
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
  let refreshMessages = $state<readonly ToastMessage[]>([]);
  let nextMessageId = 0;
  let exporting = $state(false);
  let exportMessages = $state<readonly ToastMessage[]>([]);
  const UNDO_TOAST_MS = 8_000;
  let trashMessages = $state<readonly ToastMessage[]>([]);
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

  const tree = $derived(engineState.workingTree);
  const treeLoading = $derived(engineState.synced === null && engineState.refresh.inFlight);
  const trashEntries = $derived(engineState.visibleTrash ?? []);
  const selectedPath = $derived(engineState.openNote?.path ?? null);
  const refreshing = $derived(engineState.refresh.inFlight);

  const importing = $derived(engineState.importing || importStarted !== null);
  const commands: readonly Command[] = $derived([
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
        leaveDraft();
        changePassphraseOpen = true;
      },
    },
  ]);

  const openPath = $derived(engineState.openNote?.path ?? null);
  const openConflicted = $derived(
    openPath !== null &&
      engineState.conflicts.some((held) => notePathEquals(held.path, openPath)),
  );

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

  function handleSelect(path: NotePath): void {
    leaveDraft();
    mobileView = "note";
    void engine.openNote(path);
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

  function dismissMessage(id: number): void {
    refreshMessages = refreshMessages.filter((message) => message.id !== id);
    exportMessages = exportMessages.filter((message) => message.id !== id);
    trashMessages = trashMessages.filter((message) => message.id !== id);
    importMessages = importMessages.filter((message) => message.id !== id);
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
      (notePathEquals(openPath, path) || isWithinFolder(openPath, path));
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
      onSelect={handleSelect}
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
        class="repo-label"
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        bind:this={repoLabelEl}
        title={repoLabelTruncated ? repoLabel : undefined}>{repoLabel}</a
      >
      <button type="button" class="button button-ghost" onclick={handleLogOut}>
        Log out
      </button>
    </div>
  </aside>

  <section class="note-pane" class:mobile-hidden={mobileView !== "note"}>
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
        />
      {/if}
    {/key}
    <NotePane
      bind:this={notePane}
      {engine}
      {forgeName}
      openNote={engineState.openNote}
      draft={draft !== null}
      treeLoaded={tree !== null}
      hasNotes={tree !== null && tree.root.children.length > 0}
      onDraftContent={handleDraftContent}
      onNewNote={handleHeaderNewNote}
    />
  </section>
</div>

<NoticeToasts
  notices={engineState.notices}
  messages={[
    ...refreshMessages,
    ...exportMessages,
    ...trashMessages,
    ...importMessages,
    ...sessionMessages,
  ]}
  onDismiss={(id) => engine.dismissNotice(id)}
  onDismissMessage={dismissMessage}
  onOpen={handleSelect}
/>

{#if dialog.kind === "createFolder"}
  <NameDialog
    open={true}
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
    open={true}
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
    open={true}
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
    open={true}
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
    open={true}
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
    open={true}
    {forgeName}
    canConfigure={engineState.atomicBlocked.canConfigure}
    onEnable={handleEnableAtomic}
    onSaveWithoutAtomic={() => engine.saveImportWithoutAtomic()}
    onClose={() => (atomicBlockedOpen = false)}
  />
{/if}

{#if changePassphraseOpen}
  <ChangePassphraseDialog
    open={true}
    {forgeName}
    change={passphraseChange}
    onChanged={onPassphraseChanged}
    onLogOut={handleLogOut}
    onClose={() => (changePassphraseOpen = false)}
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
    open={true}
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
    open={true}
    title="Delete permanently?"
    body="This can't be undone."
    confirmLabel="Delete permanently"
    onConfirm={handleTrashDeleteConfirm}
    onClose={closeTrashDialog}
  />
{:else if trashDialog.kind === "empty"}
  <ConfirmDialog
    open={true}
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
    padding: var(--space-2) var(--space-3);
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

  .repo-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    text-decoration: none;
  }

  .repo-label:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  .sidebar-footer .button {
    gap: var(--space-1);
    flex-shrink: 0;
    font-size: var(--font-size-sm);
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

    .mobile-hidden {
      display: flex;
    }
  }
</style>
