<script lang="ts">
  import type { WorkingNode } from "../../sync/working-tree";
  import { actionIcons } from "../browse/action-icons";
  import NoteIcon from "../browse/NoteIcon.svelte";
  import { describeColorTag } from "../browse/tag-messages";
  import TrashRow from "./TrashRow.svelte";

  interface Props {
    node: WorkingNode;
    depth: number;
    meta?: string;
    onRestore: (node: WorkingNode) => void;
    onDelete?: () => void;
  }

  const { node, depth, meta, onRestore, onDelete }: Props = $props();

  let expanded = $state(false);
  const tagId = $props.id();
  const colorTag = $derived(node.kind === "note" ? node.colorTag : null);
</script>

<li role="none">
  <div class="trash-row" style="--depth: {depth}" data-testid="trash-row">
    {#if node.kind === "folder"}
      <button
        type="button"
        class="trash-row-main"
        aria-expanded={expanded}
        title={node.name}
        onclick={() => (expanded = !expanded)}
      >
        <svg
          class="icon chevron"
          class:expanded
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M6 3.5L10.5 8 6 12.5" />
        </svg>
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M1.5 3.5h4L7 5h7.5v8.5h-13z" />
        </svg>
        <span class="trash-row-text">
          <span class="trash-row-name">{node.name}</span>
          {#if meta !== undefined}<span class="trash-row-meta">{meta}</span>{/if}
        </span>
      </button>
    {:else}
      <div class="trash-row-main" title={node.name}>
        <NoteIcon {colorTag} />
        <span class="trash-row-text">
          <span class="trash-row-name">{node.name}</span>
          {#if colorTag !== null}
            <span id={tagId} class="visually-hidden">{describeColorTag(colorTag)}</span>
          {/if}
          {#if meta !== undefined}<span class="trash-row-meta">{meta}</span>{/if}
        </span>
      </div>
    {/if}
    <button
      type="button"
      class="button button-ghost trash-action"
      aria-label={`Restore ${node.name} to…`}
      aria-describedby={colorTag !== null ? tagId : undefined}
      title="Restore to…"
      onclick={() => onRestore(node)}
    >
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {#each actionIcons.move as d (d)}
          <path {d} />
        {/each}
      </svg>
      <span class="trash-action-label">Restore to…</span>
    </button>
    {#if onDelete !== undefined}
      <button
        type="button"
        class="button button-ghost button-icon trash-action"
        aria-label={`Delete ${node.name} permanently`}
        aria-describedby={colorTag !== null ? tagId : undefined}
        title="Delete permanently"
        onclick={onDelete}
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {#each actionIcons["delete-permanently"] as d (d)}
            <path {d} />
          {/each}
        </svg>
      </button>
    {/if}
  </div>
  {#if node.kind === "folder" && expanded}
    <ul role="group">
      {#each node.children as child (child.name)}
        <TrashRow node={child} depth={depth + 1} {onRestore} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .trash-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-left: calc(var(--depth) * var(--space-4));
  }

  .trash-row-main {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: var(--space-2);
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    text-align: left;
    font-size: var(--font-size-sm);
  }

  button.trash-row-main {
    cursor: pointer;
  }

  button.trash-row-main:hover {
    background: var(--color-hover);
  }

  .trash-row-text {
    display: grid;
    min-width: 0;
  }

  .trash-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trash-row-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .chevron {
    transition: transform var(--motion-duration) var(--motion-easing);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .icon {
    flex-shrink: 0;
  }

  .trash-action {
    flex-shrink: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    gap: var(--space-1);
  }

  .trash-action:hover {
    color: var(--color-text);
  }

  @media (max-width: 767px) {
    .trash-action-label {
      display: none;
    }
  }
</style>
