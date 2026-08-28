<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import type { NotePath } from "../../changes/change";
  import type { SyncStates } from "../../sync/sync-state";
  import type { WorkingNode, WorkingTree } from "../../sync/working-tree";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";
  import RowMenu from "./RowMenu.svelte";
  import type { MenuAnchor, RowAction } from "./row-menu-types";

  interface Props {
    tree: WorkingTree | null;
    loading: boolean;
    selectedPath: NotePath | null;
    syncStates: SyncStates;
    expandRequest: { readonly path: NotePath } | null;
    onSelect: (path: NotePath) => void;
    onAction: (action: RowAction, node: WorkingNode) => void;
    onNewNote: () => void;
  }

  const {
    tree,
    loading,
    selectedPath,
    syncStates,
    expandRequest,
    onSelect,
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

  function handleMenuAction(action: RowAction): void {
    const node = openMenu?.node;
    handleCloseMenu();
    if (node !== undefined) onAction(action, node);
  }
</script>

<div class="tree-container">
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
    trigger={openMenu.trigger}
    anchor={openMenu.anchor}
    onAction={handleMenuAction}
    onClose={handleCloseMenu}
  />
{/if}

<style>
  .tree-container {
    flex: 1;
    overflow-y: auto;
  }

  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .link-button {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--color-link);
    text-decoration: underline;
    cursor: pointer;
  }

  .link-button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .tree-message {
    padding: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
