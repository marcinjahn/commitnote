<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import { describeSharesRevokedOnTrash } from "../trash/trash-messages";

  interface Props {
    itemName: string;
    itemKind: "note" | "folder";
    itemCount: number;
    shareCount: number;
    revoking: boolean;
    error: string | null;
    onConfirm: () => void;
    onClose: () => void;
  }

  const {
    itemName,
    itemKind,
    itemCount,
    shareCount,
    revoking,
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

  const confirmLabel = $derived(
    revoking
      ? "Revoking links…"
      : shareCount > 0
        ? "Revoke links and move to trash"
        : toTrash
          ? "Move to trash"
          : "Delete",
  );

  const body = $derived(
    itemKind === "note"
      ? `“${itemName}” will be moved to the trash.`
      : nonEmptyFolder
        ? `“${itemName}” and everything in it (${itemsLabel}) will be moved to the trash.`
        : `“${itemName}” will be deleted.`,
  );
</script>

<Dialog open={true} {title} onClose={() => !revoking && onClose()}>
  {#snippet children()}
    <p>{body}</p>
    {#if shareCount > 0}
      <p class="share-warning" data-testid="trash-share-warning">
        {describeSharesRevokedOnTrash(shareCount, itemKind)}
      </p>
    {/if}
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
    <button
      type="button"
      class="button button-ghost"
      disabled={revoking}
      onclick={onClose}
    >
      Cancel
    </button>
    <button
      type="button"
      class={toTrash && shareCount === 0
        ? "button button-primary"
        : "button button-danger"}
      disabled={revoking}
      onclick={onConfirm}
    >
      {confirmLabel}
    </button>
  {/snippet}
</Dialog>

<style>
  .share-warning {
    border-left: 2px solid var(--color-danger);
    padding-left: var(--space-2);
  }

  .trash-note {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
