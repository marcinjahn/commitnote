<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import { notePathEquals } from "../../changes/change";
  import type { SyncStates } from "../../sync/sync-state";
  import type { WorkingNode } from "../../sync/working-tree";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";
  import SyncStateIcon from "./SyncStateIcon.svelte";

  interface Props {
    node: WorkingNode;
    depth: number;
    selectedPath: NotePath | null;
    syncStates: SyncStates;
    isExpanded: (key: string) => boolean;
    onToggle: (key: string) => void;
    onSelect: (path: NotePath) => void;
  }

  const {
    node,
    depth,
    selectedPath,
    syncStates,
    isExpanded,
    onToggle,
    onSelect,
  }: Props = $props();

  const key = $derived(node.path.join("/"));
  const expanded = $derived(node.kind === "folder" && isExpanded(key));
  const selected = $derived(
    node.kind === "note" &&
      selectedPath !== null &&
      notePathEquals(node.path, selectedPath),
  );
  const syncState = $derived(syncStates.stateOf(node.path));

  function handleActivate(): void {
    if (node.kind === "folder") {
      onToggle(key);
    } else {
      onSelect(node.path);
    }
  }
</script>

<li role="none">
  <div class="tree-row-container">
  <button
    type="button"
    role="treeitem"
    class="tree-row"
    class:selected
    style="--depth: {depth}"
    aria-expanded={node.kind === "folder" ? expanded : undefined}
    aria-selected={node.kind === "note" ? selected : undefined}
    title={node.name}
    onclick={handleActivate}
  >
    {#if node.kind === "folder"}
      <svg
        class="row-icon chevron"
        class:expanded
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M6 4l4 4-4 4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {:else}
      <svg
        class="row-icon note-glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
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
      </svg>
    {/if}
    <span class="tree-row-label">{node.name}</span>
  </button>
  <span class="sync-indicator">
    <SyncStateIcon state={syncState} />
  </span>
  </div>
  {#if node.kind === "folder" && expanded && node.children.length > 0}
    <ul role="group">
      {#each node.children as child (child.path.join("/"))}
        <NoteTreeFolder
          node={child}
          depth={depth + 1}
          {selectedPath}
          {syncStates}
          {isExpanded}
          {onToggle}
          {onSelect}
        />
      {/each}
    </ul>
  {/if}
</li>

<style>
  li {
    list-style: none;
  }

  ul[role="group"] {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree-row-container {
    display: flex;
    align-items: center;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target);
    padding-left: calc(var(--depth, 0) * 20px + var(--space-2));
    padding-right: var(--space-2);
    border: none;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    border-radius: 0;
  }

  .sync-indicator {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding-right: var(--space-2);
  }

  .tree-row:hover {
    background: var(--color-hover);
  }

  .tree-row.selected {
    background: var(--color-selected);
  }

  .row-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .chevron {
    transition: transform 0.15s ease;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .tree-row-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
