<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import type { NotePath } from "../../changes/change";
  import type { NoteTree as NoteTreeData } from "../../tree/note-tree";
  import NoteTreeFolder from "./NoteTreeFolder.svelte";

  interface Props {
    tree: NoteTreeData | null;
    loading: boolean;
    selectedPath: NotePath | null;
    onSelect: (path: NotePath) => void;
  }

  const { tree, loading, selectedPath, onSelect }: Props = $props();

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
</script>

<div class="tree-container">
  {#if tree === null}
    {#if loading}
      <p class="tree-message">Loading notes…</p>
    {/if}
  {:else if tree.root.children.length === 0}
    <p class="tree-message">No notes yet</p>
  {:else}
    <ul class="tree" role="tree" aria-label="Notes">
      {#each tree.root.children as child (child.path.join("/"))}
        <NoteTreeFolder
          node={child}
          depth={0}
          {selectedPath}
          {isExpanded}
          {onToggle}
          {onSelect}
        />
      {/each}
    </ul>
  {/if}
</div>

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

  .tree-message {
    padding: var(--space-3);
    color: var(--color-text-muted);
  }
</style>
