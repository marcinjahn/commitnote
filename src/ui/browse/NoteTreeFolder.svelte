<script lang="ts">
  import type { NotePath } from "../../changes/change";
  import { notePathEquals } from "../../changes/change";
  import type { SyncStates } from "../../sync/sync-state";
  import type { WorkingNode } from "../../sync/working-tree";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";
  import type { MenuAnchor } from "./row-menu-types";
  import SyncStateIcon from "./SyncStateIcon.svelte";

  interface Props {
    node: WorkingNode;
    depth: number;
    selectedPath: NotePath | null;
    syncStates: SyncStates;
    isExpanded: (key: string) => boolean;
    onToggle: (key: string) => void;
    onSelect: (path: NotePath) => void;
    menuOpenKey: string | null;
    onOpenMenu: (
      key: string,
      node: WorkingNode,
      anchor: MenuAnchor,
      trigger: HTMLElement,
    ) => void;
  }

  const {
    node,
    depth,
    selectedPath,
    syncStates,
    isExpanded,
    onToggle,
    onSelect,
    menuOpenKey,
    onOpenMenu,
  }: Props = $props();

  const key = $derived(node.path.join("/"));
  const expanded = $derived(node.kind === "folder" && isExpanded(key));
  const selected = $derived(
    node.kind === "note" &&
      selectedPath !== null &&
      notePathEquals(node.path, selectedPath),
  );
  const syncState = $derived(syncStates.stateOf(node.path));
  const menuOpen = $derived(menuOpenKey === key);

  let actionsButton: HTMLButtonElement | undefined = $state();

  function handleActivate(): void {
    if (node.kind === "folder") {
      onToggle(key);
    } else {
      onSelect(node.path);
    }
  }

  function handleActionsClick(): void {
    if (actionsButton === undefined) return;
    onOpenMenu(
      key,
      node,
      { kind: "rect", rect: actionsButton.getBoundingClientRect() },
      actionsButton,
    );
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (actionsButton === undefined) return;
    onOpenMenu(
      key,
      node,
      { kind: "point", x: event.clientX, y: event.clientY },
      actionsButton,
    );
  }
</script>

<li role="none" oncontextmenu={handleContextMenu}>
  <div class="tree-row-container" class:selected>
  <button
    type="button"
    role="treeitem"
    class="tree-row"
    style="--depth: {depth}"
    aria-expanded={node.kind === "folder" ? expanded : undefined}
    aria-selected={node.kind === "note" ? selected : undefined}
    title={node.name}
    onclick={handleActivate}
  >
    {#if node.kind === "folder"}
      <svg
        class="icon row-icon chevron"
        class:expanded
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M6 3.5L10.5 8 6 12.5" />
      </svg>
      <svg
        class="icon row-icon folder-glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M1.5 3.5h4L7 5h7.5v8.5h-13z" />
      </svg>
    {:else}
      <svg
        class="icon row-icon note-glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3.5 1.5h6l3 3v10h-9z" />
        <path d="M9.5 1.5v3h3" />
      </svg>
    {/if}
    <span class="tree-row-label">{node.name}</span>
  </button>
  {#if syncState.kind !== "synced"}
    <span class="sync-indicator">
      <SyncStateIcon state={syncState} />
    </span>
  {/if}
  <button
    type="button"
    class="row-actions"
    class:menu-open={menuOpen}
    bind:this={actionsButton}
    aria-label={`Actions for ${node.name}`}
    aria-haspopup="menu"
    onclick={handleActionsClick}
  >
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  </button>
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
          {menuOpenKey}
          {onOpenMenu}
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
    transition: background-color var(--motion-duration) var(--motion-easing);
  }

  .tree-row-container:hover {
    background: var(--color-hover);
  }

  .tree-row-container.selected {
    background: var(--color-selected);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }

  .tree-row-container.selected .tree-row-label {
    font-weight: var(--font-weight-medium);
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target);
    padding-left: calc(var(--depth, 0) * var(--space-4) + var(--space-2));
    padding-right: var(--space-2);
    border: none;
    background: transparent;
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    border-radius: 0;
  }

  .tree-row:focus-visible,
  .row-actions:focus-visible {
    outline-offset: -2px;
  }

  .sync-indicator {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding-right: var(--space-2);
  }

  .row-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .chevron {
    transition: transform var(--motion-duration) var(--motion-easing);
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
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }

  .row-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: var(--touch-target);
    margin-right: var(--space-1);
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 1;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      opacity var(--motion-duration) var(--motion-easing);
  }

  .row-actions:hover {
    background: color-mix(in srgb, var(--color-text) 8%, transparent);
  }

  @media (pointer: fine) and (min-width: 768px) {
    .row-actions {
      opacity: 0;
    }

    .tree-row-container:hover .row-actions,
    .tree-row-container:focus-within .row-actions,
    .row-actions.menu-open {
      opacity: 1;
    }
  }
</style>
