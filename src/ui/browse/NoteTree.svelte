<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import type { NotePath } from "../../changes/change";
  import { isAtOrWithin } from "../../changes/change";
  import type { SyncStates } from "../../sync/sync-state";
  import type { WorkingNode, WorkingTree } from "../../sync/working-tree";
  import { findWorkingNode } from "../../sync/working-tree";
  import type { DropTarget } from "./tree-drop";
  import { treeDrag, type TreeDragOptions } from "./tree-drag";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";
  import { countDescendants } from "../dialogs/folder-options";
  import RowMenu from "./RowMenu.svelte";
  import type { MenuAnchor, RowAction } from "./row-menu-types";

  interface Props {
    tree: WorkingTree | null;
    loading: boolean;
    selectedPath: NotePath | null;
    syncStates: SyncStates;
    expandRequest: { readonly path: NotePath } | null;
    conflicts: readonly NotePath[];
    onSelect: (path: NotePath) => void;
    onPlace: (path: NotePath, target: DropTarget) => NotePath | null;
    noteDropArea: () => HTMLElement | null;
    onDropOpen: (path: NotePath) => void;
    onAction: (action: RowAction, node: WorkingNode) => void;
    onNewNote: () => void;
  }

  const {
    tree,
    loading,
    selectedPath,
    syncStates,
    expandRequest,
    conflicts,
    onSelect,
    onPlace,
    noteDropArea,
    onDropOpen,
    onAction,
    onNewNote,
  }: Props = $props();

  const expanded = new SvelteMap<string, boolean>();

  function isExpanded(key: string): boolean {
    return expanded.get(key) ?? false;
  }

  function onToggle(key: string): void {
    expanded.set(key, !isExpanded(key));
  }

  $effect(() => {
    const path = selectedPath;
    if (path === null) return;
    for (let depth = 1; depth < path.length; depth++) {
      expanded.set(path.slice(0, depth).join("/"), true);
    }
  });

  // Set by the parent after a structure change (e.g. a newly created
  // folder) so it becomes visible even without a selection change.
  $effect(() => {
    const request = expandRequest;
    if (request === null) return;
    for (let depth = 1; depth <= request.path.length; depth++) {
      expanded.set(request.path.slice(0, depth).join("/"), true);
    }
  });

  interface OpenMenu {
    readonly key: string;
    readonly node: WorkingNode;
    readonly anchor: MenuAnchor;
    readonly trigger: HTMLElement;
  }

  function containsFolder(nodes: readonly WorkingNode[]): boolean {
    return nodes.some((n) => n.kind === "folder");
  }

  const hasFolders = $derived(tree !== null && containsFolder(tree.root.children));

  let openMenu = $state<OpenMenu | null>(null);

  function handleOpenMenu(
    key: string,
    node: WorkingNode,
    anchor: MenuAnchor,
    trigger: HTMLElement,
  ): void {
    if (openMenu?.key === key && anchor.kind === "rect") {
      handleCloseMenu();
      return;
    }
    openMenu = { key, node, anchor, trigger };
  }

  function handleCloseMenu(): void {
    const trigger = openMenu?.trigger ?? null;
    openMenu = null;
    trigger?.focus();
  }

  const dragOptions: TreeDragOptions = {
    scene(dragged) {
      const current = tree;
      if (current === null) return null;
      const node = findWorkingNode(current, dragged);
      if (node === undefined) return null;
      return {
        draggedKind: node.kind,
        conflicted: conflicts.some(
          (path) => isAtOrWithin(path, dragged),
        ),
        childrenOf(folder) {
          const found = findWorkingNode(current, folder);
          return found?.kind === "folder"
            ? found.children.map((child) => child.name)
            : undefined;
        },
      };
    },
    onDrop: (path, target) => onPlace(path, target),
    noteArea: () => noteDropArea(),
    onOpen: (path) => onDropOpen(path),
    onMenu(row, x, y) {
      const current = tree;
      if (current === null) return;
      const node = findWorkingNode(
        current,
        JSON.parse(row.dataset.treePath ?? "[]") as NotePath,
      );
      const trigger = row.querySelector<HTMLElement>('[aria-haspopup="menu"]');
      if (node === undefined || trigger === null) return;
      handleOpenMenu(node.path.join("/"), node, { kind: "point", x, y }, trigger);
    },
  };

  function handleMenuAction(action: RowAction): void {
    const node = openMenu?.node;
    handleCloseMenu();
    if (node !== undefined) onAction(action, node);
  }
</script>

<div class="tree-container" use:treeDrag={dragOptions}>
  {#if tree === null}
    {#if loading}
      <p class="tree-message">Loading notes…</p>
    {/if}
  {:else if tree.root.children.length === 0}
    <p class="tree-message">
      No notes yet,
      <button type="button" class="link-button" onclick={onNewNote}>create one</button>
    </p>
  {:else}
    <ul class="tree" role="tree" aria-label="Notes">
      {#each tree.root.children as child (child.path.join("/"))}
        <NoteTreeFolder
          node={child}
          depth={0}
          {selectedPath}
          {syncStates}
          {isExpanded}
          {onToggle}
          {onSelect}
          menuOpenKey={openMenu?.key ?? null}
          onOpenMenu={handleOpenMenu}
        />
      {/each}
    </ul>
  {/if}
</div>

{#if openMenu !== null}
  <RowMenu
    name={openMenu.node.name}
    kind={openMenu.node.kind}
    {hasFolders}
    trashes={openMenu.node.kind === "note" || countDescendants(openMenu.node) > 0}
    trigger={openMenu.trigger}
    anchor={openMenu.anchor}
    onAction={handleMenuAction}
    onClose={handleCloseMenu}
  />
{/if}

<style>
  .tree-container {
    position: relative;
    flex: 1;
    overflow-y: auto;
  }

  .tree-container:global([data-drag-state]) {
    user-select: none;
  }

  .tree-container:global([data-drag-state="dragging"]) {
    cursor: grabbing;
  }

  .tree-container:global([data-drag-state="dragging"]) :global([data-tree-row]) {
    transition:
      transform 200ms var(--motion-easing),
      opacity 200ms var(--motion-easing),
      background-color var(--motion-duration) var(--motion-easing);
  }

  .tree-container :global([data-tree-row][data-drag-source]) {
    opacity: 0.4;
  }

  .tree-container :global([data-tree-row][data-drop-into]) {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    box-shadow: inset 0 0 0 1.5px
      color-mix(in srgb, var(--color-accent) 70%, transparent);
  }

  .tree-container :global(.tree-drop-slot) {
    position: absolute;
    top: 0;
    right: var(--space-2);
    box-sizing: border-box;
    border: 1.5px dashed color-mix(in srgb, var(--color-accent) 65%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    pointer-events: none;
    transition:
      translate 200ms var(--motion-easing),
      left 200ms var(--motion-easing);
  }

  @media (prefers-color-scheme: dark) {
    .tree-container :global([data-tree-row][data-drop-into]) {
      background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    }

    .tree-container :global(.tree-drop-slot) {
      border-color: color-mix(in srgb, var(--color-accent) 80%, transparent);
      background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    }
  }

  :global(.tree-drag-preview) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    overflow: hidden;
    pointer-events: none;
    background: var(--color-surface-raised);
    color: var(--color-text);
    border-radius: 0;
    box-shadow: none;
    scale: 1;
    transition:
      width 200ms var(--motion-easing),
      margin-left 200ms var(--motion-easing),
      border-radius 200ms var(--motion-easing),
      box-shadow 200ms var(--motion-easing),
      scale 200ms var(--motion-easing),
      opacity 200ms var(--motion-easing);
  }

  :global(.tree-drag-preview.tree-drag-preview [data-drag-handle]) {
    transition: padding-left 200ms var(--motion-easing);
  }

  :global(.tree-drag-preview.lifted) {
    border-radius: 8px;
    box-shadow: var(--shadow-2);
    scale: 1.03;
  }

  :global(.tree-drag-preview.lifted [data-drag-handle]) {
    padding-left: 12px;
  }

  :global(.tree-drag-preview.refused) {
    opacity: 0.55;
  }

  :global(.tree-drag-preview.settling) {
    transition-property:
      translate, width, margin-left, border-radius, box-shadow, scale, opacity;
  }

  :global(.tree-drag-preview.fading) {
    opacity: 0;
    scale: 0.9;
  }

  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree-message {
    padding: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
