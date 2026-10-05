<script lang="ts">
  import Dialog from "./Dialog.svelte";

  interface Props {
    itemName: string;
    itemKind: "note" | "folder";
    itemCount: number;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
  }

  const {
    itemName,
    itemKind,
    itemCount,
    error,
    onConfirm,
    onClose,
  }: Props = $props();

  const nonEmptyFolder = $derived(itemKind === "folder" && itemCount > 0);

  const toTrash = $derived(itemKind === "note" || nonEmptyFolder);

  const title = $derived(
    toTrash
      ? "Move to trash?"
      : "Delete folder?",
  );

  const itemsLabel = $derived(
    `${itemCount} ${itemCount === 1 ? "item" : "items"}`,
  );

  const body = $derived(
    itemKind === "note"
      ? `“${itemName}” will be moved to the trash.`
      : nonEmptyFolder
        ? `“${itemName}” and everything in it (${itemsLabel}) will be moved to the trash.`
        : `“${itemName}” will be deleted.`,
  );
</script>

<Dialog open={true} {title} {onClose}>
  {#snippet children()}
    <p>{body}</p>
    {#if toTrash}
      <p class="trash-note">
        Items in the trash are deleted permanently after 30 days.
      </p>
    {/if}
    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}
  {/snippet}
  {#snippet actions()}
    <button type="button" class="button button-ghost" onclick={onClose}>
      Cancel
    </button>
    <button
      type="button"
      class={toTrash ? "button button-primary" : "button button-danger"}
      onclick={onConfirm}
    >
      {toTrash ? "Move to trash" : "Delete"}
    </button>
  {/snippet}
</Dialog>

<style>
  .trash-note {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
