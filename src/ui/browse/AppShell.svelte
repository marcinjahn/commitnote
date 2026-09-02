<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { isWithinFolder, notePathEquals, parentPath } from "../../changes/change";
  import type { SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import { findWorkingNode } from "../../sync/working-tree";
  import type { WorkingNode } from "../../sync/working-tree";
  import { buildNotesArchive } from "../../export/notes-archive";
  import DeleteDialog from "../dialogs/DeleteDialog.svelte";
  import { actionIcons } from "./action-icons";
  import { countDescendants } from "../dialogs/folder-options";
  import MoveDialog from "../dialogs/MoveDialog.svelte";
  import NameDialog from "../dialogs/NameDialog.svelte";
  import { decideNameCommit } from "../note/name-field-commit";
  import { resolveNoteDraft, type NoteDraft } from "../note/note-draft";
  import NotePane from "../note/NotePane.svelte";
  import type { ToastMessage } from "../notices/notice-messages";
  import NoticeToasts from "../notices/NoticeToasts.svelte";
  import NoteHeader from "./NoteHeader.svelte";
  import NoteTree from "./NoteTree.svelte";
  import RefreshButton from "./RefreshButton.svelte";
  import Wordmark from "../wordmark/Wordmark.svelte";
  import type { RowAction } from "./row-menu-types";
  import { describeStructureError } from "./structure-messages";
  import { describeSyncError } from "./sync-messages";

  interface Props {
    engine: SyncEngine;
    repoLabel: string;
    repoUrl: string;
    forgeName: string;
    onLogOut: () => void;
  }

  const { engine, repoLabel, repoUrl, forgeName, onLogOut }: Props = $props();

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

  $effect(() => {
    return engine.subscribe((next) => {
      engineState = next;
    });
  });

  const tree = $derived(engineState.workingTree);
  const treeLoading = $derived(engineState.synced === null && engineState.refresh.inFlight);
  const selectedPath = $derived(engineState.openNote?.path ?? null);
  const refreshing = $derived(engineState.refresh.inFlight);

  const openPath = $derived(engineState.openNote?.path ?? null);
  const openConflicted = $derived(
    openPath !== null &&
      engineState.conflicts.some((held) => notePathEquals(held.path, openPath)),
  );

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

  function exportFileName(now: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `commitnote-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
  }

  async function handleExport(): Promise<void> {
    const snapshot = engine.snapshotNotes();
    if (snapshot === null || exporting) return;
    exporting = true;
    exportMessages = [];
    try {
      const now = new Date();
      const archive = await buildNotesArchive(snapshot.tree.root, snapshot.readNote, now);
      const url = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFileName(now);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      exportMessages = [{ id: ++nextMessageId, text: "Export failed. Try again later." }];
    } finally {
      exporting = false;
    }
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

  function handleDeleteConfirm(): void {
    if (dialog.kind !== "delete") return;
    const path = dialog.node.path;
    const affectsOpenNote =
      openPath !== null &&
      (notePathEquals(openPath, path) || isWithinFolder(openPath, path));
    const result = engine.delete(path);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    closeDialog();
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
    <div class="sidebar-footer">
      <a
        class="repo-label"
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        bind:this={repoLabelEl}
        title={repoLabelTruncated ? repoLabel : undefined}>{repoLabel}</a
      >
      <button
        type="button"
        class="button button-ghost"
        disabled={tree === null || exporting}
        onclick={handleExport}
      >
        {exporting ? "Exporting…" : "Export"}
      </button>
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
      hasNotes={tree !== null && tree.root.children.length > 0}
      onDraftContent={handleDraftContent}
      onNewNote={handleHeaderNewNote}
    />
  </section>
</div>

<NoticeToasts
  notices={engineState.notices}
  messages={[...refreshMessages, ...exportMessages]}
  onDismiss={(id) => engine.dismissNotice(id)}
  onDismissMessage={(id) => {
    refreshMessages = refreshMessages.filter((message) => message.id !== id);
    exportMessages = exportMessages.filter((message) => message.id !== id);
  }}
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

    .mobile-hidden {
      display: flex;
    }
  }
</style>
