<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { NotePath } from "../../changes/change";
  import { isAtOrWithin, parentPath } from "../../changes/change";
  import type { SyncStates } from "../../sync/sync-state";
  import type { WorkingNode, WorkingTree } from "../../sync/working-tree";
  import { findWorkingNode } from "../../sync/working-tree";
  import type { DropTarget } from "./tree-drop";
  import { treeDrag, type TreeDragOptions } from "./tree-drag";
  import { treeFileDrop } from "./tree-file-drop";
  import type { ImportDestination } from "../../import/plan-import";
  import type { DroppedFile } from "../../import/read-dropped-files";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";
  import type { TreeExpansion } from "./tree-expansion.svelte";
  import { countDescendants } from "../dialogs/folder-options";
  import type { ColorTag } from "../../tags/color-tag";
  import RowMenu from "./RowMenu.svelte";
  import type { MenuAnchor, RowAction } from "./row-menu-types";
  import { siblingMoveBefore } from "./sibling-move";
  import { treeKeyTarget, typeaheadIndex, visibleRows } from "./tree-keyboard";

  interface Props {
    tree: WorkingTree | null;
    filteredTree: WorkingTree | null;
    loading: boolean;
    selectedPath: NotePath | null;
    syncStates: SyncStates;
    expandRequest: { readonly path: NotePath } | null;
    expansion: TreeExpansion;
    conflicts: readonly NotePath[];
    onSelect: (path: NotePath) => void;
    onPlace: (path: NotePath, target: DropTarget) => NotePath | null;
    noteDropArea: () => HTMLElement | null;
    onDropOpen: (path: NotePath) => void;
    trashDropArea: () => HTMLElement | null;
    onTrash: (path: NotePath) => void;
    onDragStateChange: (active: boolean) => void;
    onAction: (action: RowAction, node: WorkingNode) => void;
    tagsWritable: boolean;
    onColorTag: (path: NotePath, color: ColorTag | null) => void;
    onNewNote: () => void;
    onFileDrop: (files: readonly DroppedFile[], destination: ImportDestination) => void;
  }

  const {
    tree,
    filteredTree,
    loading,
    selectedPath,
    syncStates,
    expandRequest,
    expansion,
    conflicts,
    onSelect,
    onPlace,
    noteDropArea,
    onDropOpen,
    trashDropArea,
    onTrash,
    onDragStateChange,
    onAction,
    tagsWritable,
    onColorTag,
    onNewNote,
    onFileDrop,
  }: Props = $props();

  function isExpanded(path: NotePath): boolean {
    return filteredTree !== null || expansion.isExpanded(path);
  }

  function onToggle(path: NotePath): void {
    if (filteredTree !== null) return;
    expansion.setExpanded(path, !expansion.isExpanded(path));
  }

  $effect(() => {
    const path = selectedPath;
    if (path === null || untrack(() => filteredTree) !== null) return;
    untrack(() => {
      for (let depth = 1; depth < path.length; depth++) {
        expansion.setExpanded(path.slice(0, depth), true);
      }
    });
  });

  // Set by the parent after a structure change (e.g. a newly created
  // folder) so it becomes visible even without a selection change.
  $effect(() => {
    const request = expandRequest;
    if (request === null || untrack(() => filteredTree) !== null) return;
    untrack(() => {
      for (let depth = 1; depth <= request.path.length; depth++) {
        expansion.setExpanded(request.path.slice(0, depth), true);
      }
    });
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

  const openMenuSiblings = $derived.by(() => {
    if (openMenu === null || tree === null) return [];
    const parent = findWorkingNode(tree, parentPath(openMenu.node.path));
    return parent?.kind === "folder" ? parent.children.map((child) => child.name) : [];
  });

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
    const full = tree === null ? undefined : findWorkingNode(tree, node.path);
    openMenu = { key, node: full ?? node, anchor, trigger };
  }

  function handleCloseMenu(): void {
    const path = openMenu?.node.path ?? null;
    openMenu = null;
    const target =
      (path === null ? null : treeitemFor(JSON.stringify(path))) ??
      treeEl?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
    target?.focus();
  }

  let treeEl: HTMLUListElement | undefined = $state();

  const rows = $derived.by(() => {
    const displayed = filteredTree ?? tree;
    return displayed === null ? [] : visibleRows(displayed.root, isExpanded);
  });

  let lastFocusedKey = $state<string | null>(null);

  const tabbableKey = $derived.by(() => {
    const keys = rows.map((row) => JSON.stringify(row.path));
    if (lastFocusedKey !== null && keys.includes(lastFocusedKey)) return lastFocusedKey;
    const openKey = selectedPath === null ? null : JSON.stringify(selectedPath);
    if (openKey !== null && keys.includes(openKey)) return openKey;
    return keys[0] ?? null;
  });

  function rowElementFor(key: string): HTMLElement | null {
    for (const row of treeEl?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? []) {
      if (row.dataset.treePath === key) return row;
    }
    return null;
  }

  function treeitemFor(key: string): HTMLElement | null {
    return rowElementFor(key)?.querySelector<HTMLElement>('[role="treeitem"]') ?? null;
  }

  function rowKeyOf(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "treeitem") {
      return null;
    }
    return target.closest<HTMLElement>("[data-tree-row]")?.dataset.treePath ?? null;
  }

  function focusRow(index: number): void {
    const row = rows[index];
    if (row === undefined) return;
    const item = treeitemFor(JSON.stringify(row.path));
    if (item === null) return;
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: "nearest" });
  }

  let focusedKey: string | null = null;

  function handleFocusIn(event: FocusEvent): void {
    const key = rowKeyOf(event.target);
    if (key === null) return;
    lastFocusedKey = key;
    focusedKey = key;
  }

  function handleFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && !treeEl?.contains(next)) focusedKey = null;
  }

  export function focusedPath(): NotePath | null {
    return focusedKey === null ? null : (JSON.parse(focusedKey) as NotePath);
  }

  export function containsFocus(): boolean {
    return treeEl?.contains(document.activeElement) ?? false;
  }

  export async function focusPath(path: NotePath): Promise<boolean> {
    await tick();
    const item = treeitemFor(JSON.stringify(path));
    if (item === null) return false;
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: "nearest" });
    return true;
  }

  const TYPEAHEAD_RESET_MS = 500;
  let typeahead = "";
  let typeaheadAt = -Infinity;

  const NAVIGATION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "ArrowRight",
    "ArrowLeft",
  ]);

  function handleTreeKeydown(event: KeyboardEvent): void {
    const key = rowKeyOf(event.target);
    if (key === null || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const current = rows.findIndex((row) => JSON.stringify(row.path) === key);
    if (current === -1) return;

    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      event.preventDefault();
      typeahead = "";
      openRowMenu(key);
      return;
    }

    if (NAVIGATION_KEYS.has(event.key)) {
      event.preventDefault();
      typeahead = "";
      const result = treeKeyTarget(rows, current, event.key);
      if (result.kind === "focus") {
        focusRow(result.index);
      } else if (result.kind === "expand" || result.kind === "collapse") {
        const row = rows[result.index];
        if (row !== undefined) onToggle(row.path);
      }
      return;
    }

    if (event.key.length !== 1) return;
    if (event.timeStamp - typeaheadAt > TYPEAHEAD_RESET_MS) typeahead = "";
    if (event.key === " " && typeahead === "") return;
    event.preventDefault();
    typeahead += event.key;
    typeaheadAt = event.timeStamp;
    const chars = Array.from(typeahead);
    const repeated = chars.every((c) => c.toLocaleLowerCase() === chars[0]!.toLocaleLowerCase());
    // A longer prefix may still match the focused row, so the search starts on it.
    const target = typeaheadIndex(rows, repeated ? current : current - 1, typeahead);
    if (target !== null) focusRow(target);
  }

  function openRowMenu(key: string): void {
    const current = tree;
    const row = rowElementFor(key);
    if (current === null || row === null) return;
    const node = findWorkingNode(current, JSON.parse(key) as NotePath);
    const trigger = row.querySelector<HTMLElement>('[aria-haspopup="menu"]');
    if (node === undefined || trigger === null) return;
    handleOpenMenu(
      node.path.join("/"),
      node,
      { kind: "rect", rect: row.getBoundingClientRect() },
      trigger,
    );
  }

  const dragOptions: TreeDragOptions = $derived({
    reorder: filteredTree === null,
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
    trashArea: () => trashDropArea(),
    onTrash: (path) => onTrash(path),
    onDragStateChange: (active) => onDragStateChange(active),
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
  });

  function handleMenuAction(action: RowAction): void {
    const node = openMenu?.node;
    handleCloseMenu();
    if (node !== undefined) onAction(action, node);
  }

  const openMenuColorTag = $derived.by(() => {
    if (openMenu === null || tree === null) return null;
    const current = findWorkingNode(tree, openMenu.node.path);
    return current?.kind === "note" ? current.colorTag : null;
  });

  function handleColorTag(color: ColorTag | null): void {
    const node = openMenu?.node;
    handleCloseMenu();
    if (node !== undefined) onColorTag(node.path, color);
  }
</script>

<div
  class="tree-container"
  use:treeDrag={dragOptions}
  use:treeFileDrop={{ onDrop: (files, destination) => onFileDrop(files, destination) }}
>
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
    <ul
      class="tree"
      role="tree"
      aria-label="Notes"
      bind:this={treeEl}
      onfocusin={handleFocusIn}
      onfocusout={handleFocusOut}
      onkeydown={handleTreeKeydown}
    >
      {#each (filteredTree ?? tree).root.children as child, index (child.path.join("/"))}
        <NoteTreeFolder
          node={child}
          depth={0}
          posinset={index + 1}
          setsize={(filteredTree ?? tree).root.children.length}
          {tabbableKey}
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
    canMoveUp={siblingMoveBefore(openMenuSiblings, openMenu.node.name, "up") !== null}
    canMoveDown={siblingMoveBefore(openMenuSiblings, openMenu.node.name, "down") !== null}
    trashes={openMenu.node.kind === "note" || countDescendants(openMenu.node) > 0}
    trigger={openMenu.trigger}
    anchor={openMenu.anchor}
    colorTag={openMenuColorTag}
    {tagsWritable}
    onColorTag={handleColorTag}
    onAction={handleMenuAction}
    onClose={handleCloseMenu}
  />
{/if}

<style>
  .tree-container {
    position: relative;
    flex: 1;
    overflow-y: auto;
    scroll-padding-bottom: var(--toast-stack-height, 0px);
  }

  @media (max-height: 480px) {
    .tree-container {
      flex: 1 0 auto;
      min-height: 10rem;
    }
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

  .tree-container:global([data-drop-into]),
  .tree-container :global([data-tree-row][data-drop-into]) {
    background: light-dark(
      color-mix(in srgb, var(--color-accent) 16%, transparent),
      color-mix(in srgb, var(--color-accent) 22%, transparent)
    );
    box-shadow: inset 0 0 0 1.5px
      color-mix(in srgb, var(--color-accent) 70%, transparent);
  }

  .tree-container :global(.tree-drop-slot) {
    position: absolute;
    top: 0;
    right: var(--space-2);
    box-sizing: border-box;
    border: 1.5px dashed
      light-dark(
        color-mix(in srgb, var(--color-accent) 65%, transparent),
        color-mix(in srgb, var(--color-accent) 80%, transparent)
      );
    border-radius: 8px;
    background: light-dark(
      color-mix(in srgb, var(--color-accent) 10%, transparent),
      color-mix(in srgb, var(--color-accent) 16%, transparent)
    );
    pointer-events: none;
    transition:
      translate 200ms var(--motion-easing),
      left 200ms var(--motion-easing);
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

  @media (forced-colors: active) {
    .tree-container:global([data-drop-into]),
    .tree-container :global([data-tree-row][data-drop-into]) {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }

    .tree-container :global(.tree-drop-slot) {
      border-color: Highlight;
    }
  }
</style>
