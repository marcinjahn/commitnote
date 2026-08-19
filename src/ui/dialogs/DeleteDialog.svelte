<script lang="ts">
  import Dialog from "./Dialog.svelte";

  interface Props {
    open: boolean;
    itemName: string;
    itemKind: "note" | "folder";
    itemCount: number;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
  }

  const {
    open,
    itemName,
    itemKind,
    itemCount,
    error,
    onConfirm,
    onClose,
  }: Props = $props();

  const nonEmptyFolder = $derived(itemKind === "folder" && itemCount > 0);

  const title = $derived(
    itemKind === "note"
      ? "Delete note?"
      : nonEmptyFolder
        ? "Delete folder and its contents?"
        : "Delete folder?",
  );

  const body = $derived(
    nonEmptyFolder
      ? `“${itemName}” is not empty. It and everything in it (${itemCount} ${
          itemCount === 1 ? "item" : "items"
        }) will be deleted.`
      : `“${itemName}” will be deleted.`,
  );
</script>

<Dialog {open} {title} {onClose}>
  {#snippet children()}
    <p>{body}</p>
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
      class="button button-danger"
      onclick={onConfirm}
    >
      Delete
    </button>
  {/snippet}
</Dialog>

<style>
  .button-danger {
    background: var(--color-danger-surface);
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  .button-danger:hover {
    filter: brightness(0.95);
  }
</style>
