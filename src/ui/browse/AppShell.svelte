<script lang="ts">
  import { untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import type { SyncEngine, SyncEngineState } from "../../sync/sync-engine";
  import NotePane from "../note/NotePane.svelte";
  import NoteHeader from "./NoteHeader.svelte";
  import NoteTree from "./NoteTree.svelte";
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
</script>

<div class="shell">
  <aside class="sidebar" class:mobile-hidden={mobileView !== "tree"}>
    <div class="tree-header">
      <span class="repo-label" title={repoLabel}>{repoLabel}</span>
      <div class="tree-header-actions">
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
      onSelect={handleSelect}
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
