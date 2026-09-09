<script lang="ts">
  import type { ReadableWorkingTrashEntry } from "../../sync/working-trash";
  import type { WorkingNode } from "../../sync/working-tree";
  import Dialog from "../dialogs/Dialog.svelte";
  import TrashRow from "./TrashRow.svelte";
  import {
    describeDaysLeft,
    describeOriginalFolder,
  } from "./trash-messages";

  interface Props {
    open: boolean;
    entries: readonly ReadableWorkingTrashEntry[];
    now: number;
    onRestore: (entry: ReadableWorkingTrashEntry, node: WorkingNode) => void;
    onDelete: (entry: ReadableWorkingTrashEntry) => void;
    onEmpty: () => void;
    onClose: () => void;
  }

  const { open, entries, now, onRestore, onDelete, onEmpty, onClose }: Props =
    $props();

  const sorted = $derived(
    [...entries].sort((a, b) => b.deletedAt - a.deletedAt),
  );
</script>

<Dialog {open} title="Trash" large {onClose}>
  {#snippet children()}
    <ul class="trash-list" data-testid="trash-list">
      {#each sorted as entry (entry.id)}
        <TrashRow
          node={entry.tree}
          depth={0}
          meta={`${describeOriginalFolder(entry.originalPath)} · ${describeDaysLeft(entry.deletedAt, now)}`}
          onRestore={(node) => onRestore(entry, node)}
          onDelete={() => onDelete(entry)}
        />
      {/each}
    </ul>
  {/snippet}
  {#snippet actions()}
    <button
      type="button"
      class="button button-danger"
      data-testid="empty-trash"
      onclick={onEmpty}
    >
      Empty trash
    </button>
    <button type="button" class="button button-ghost" onclick={onClose}>
      Close
    </button>
  {/snippet}
</Dialog>

<style>
  .trash-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
