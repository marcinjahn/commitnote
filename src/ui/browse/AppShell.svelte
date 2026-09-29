<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { isWithinFolder, notePathEquals, parentPath } from "../../changes/change";
  import type { SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import { findWorkingNode } from "../../sync/working-tree";
  import type { WorkingNode } from "../../sync/working-tree";
  import DeleteDialog from "../dialogs/DeleteDialog.svelte";
  import { countDescendants } from "../dialogs/folder-options";
  import MoveDialog from "../dialogs/MoveDialog.svelte";
  import NameDialog from "../dialogs/NameDialog.svelte";
  import NotePane from "../note/NotePane.svelte";
  import NoticeToasts from "../notices/NoticeToasts.svelte";
  import NoteHeader from "./NoteHeader.svelte";
  import NoteTree from "./NoteTree.svelte";
  import type { RowAction } from "./row-menu-types";
  import { describeStructureError } from "./structure-messages";
  import { describeSyncError } from "./sync-messages";

  interface Props {
    engine: SyncEngine;
    repoLabel: string;
    onLogOut: () => void;
  }

  const { engine, repoLabel, onLogOut }: Props = $props();

  let engineState = $state<SyncEngineState>(untrack(() => engine.getState()));
  let mobileView = $state<"tree" | "note">("tree");
  let viewMode = $state<"editor" | "reading">("editor");

  type DialogState =
    | { readonly kind: "none" }
    | {
        readonly kind: "createNote" | "createFolder";
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
  let expandRequest = $state<{ readonly path: NotePath } | null>(null);

  $effect(() => {
    return engine.subscribe((next) => {
      engineState = next;
    });
  });

  $effect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (engineState.openNote === null) return;
      const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (!modifierPressed || event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      handleToggleView();
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  const tree = $derived(engineState.workingTree);
  const treeLoading = $derived(engineState.synced === null && engineState.refresh.inFlight);
  const selectedPath = $derived(engineState.openNote?.path ?? null);
  const refreshing = $derived(engineState.refresh.inFlight);

  function noteName(path: NotePath): string {
    return path[path.length - 1];
  }

  function handleSelect(path: NotePath): void {
    mobileView = "note";
    void engine.openNote(path);
  }

  function handleBack(): void {
    mobileView = "tree";
  }

  function handleRefresh(): void {
    void engine.refresh();
  }

  function handleToggleView(): void {
    viewMode = viewMode === "editor" ? "reading" : "editor";
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
    dialog = {
      kind: "createNote",
      parent: [],
      siblingNames: siblingNamesOf([]),
      error: null,
    };
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
        dialog = {
          kind: "createNote",
          parent: node.path,
          siblingNames: siblingNamesOf(node.path),
          error: null,
        };
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

  function handleCreateNoteSubmit(name: string): void {
    if (dialog.kind !== "createNote") return;
    const result = engine.createNote(dialog.parent, name);
    if (!result.ok) {
      dialog = { ...dialog, error: describeStructureError(result.error) };
      return;
    }
    const parent = dialog.parent;
    closeDialog();
    expandFolder(parent);
    mobileView = "note";
    void engine.openNote(result.path);
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
    const openPath = engineState.openNote?.path ?? null;
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
      <span class="repo-label" title={repoLabel}>{repoLabel}</span>
      <div class="tree-header-actions">
        <button
          type="button"
          class="button button-icon"
          aria-label="New note"
          disabled={tree === null}
          onclick={handleHeaderNewNote}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M4 1.5h5.5L12 4v10.5H4z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
            <path
              d="M9.5 1.5V4H12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
            <path
              d="M8 7.5v4M6 9.5h4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="button button-icon"
          aria-label="New folder"
          disabled={tree === null}
          onclick={handleHeaderNewFolder}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M1.5 4.5h4l1.2 1.5H14.5v8h-13z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
            <path
              d="M8 8v4M6 10h4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="button button-icon"
          aria-label="Refresh"
          aria-busy={refreshing}
          disabled={refreshing}
          onclick={handleRefresh}
        >
          <svg
            class="refresh-icon"
            class:spinning={refreshing}
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.7-3.98M13.5 2.5v3.5H10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button type="button" class="button" onclick={onLogOut}>
          Log out
        </button>
      </div>
    </div>
    {#if engineState.refresh.lastError !== null}
      <p role="alert" class="alert-error">
        {describeSyncError(engineState.refresh.lastError)}
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
    />
  </aside>

  <section class="note-pane" class:mobile-hidden={mobileView !== "note"}>
    {#if engineState.openNote !== null}
      <NoteHeader
        name={noteName(engineState.openNote.path)}
        {refreshing}
        syncState={engineState.syncStates.stateOf(engineState.openNote.path)}
        {viewMode}
        onToggleView={handleToggleView}
        onRefresh={handleRefresh}
        onBack={handleBack}
      />
    {/if}
    <NotePane {engine} openNote={engineState.openNote} {viewMode} />
  </section>
</div>

<NoticeToasts
  notices={engineState.notices}
  onDismiss={(id) => engine.dismissNotice(id)}
  onOpen={handleSelect}
/>

{#if dialog.kind === "createNote" || dialog.kind === "createFolder"}
  <NameDialog
    open={true}
    title={dialog.kind === "createNote" ? "New note" : "New folder"}
    label={dialog.kind === "createNote" ? "Note name" : "Folder name"}
    initialName=""
    siblingNames={dialog.siblingNames}
    submitLabel="Create"
    error={dialog.error}
    onSubmit={dialog.kind === "createNote"
      ? handleCreateNoteSubmit
      : handleCreateFolderSubmit}
    onClose={closeDialog}
  />
{:else if dialog.kind === "rename"}
  <NameDialog
    open={true}
    title={dialog.node.kind === "note" ? "Rename note" : "Rename folder"}
    label={dialog.node.kind === "note" ? "Note name" : "Folder name"}
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

  .tree-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .repo-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .tree-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .refresh-icon.spinning {
    animation: spin 0.8s linear infinite;
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
      border-right: 1px solid var(--color-border);
    }

    .note-pane {
      flex: 1;
    }

    .mobile-hidden {
      display: flex;
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
