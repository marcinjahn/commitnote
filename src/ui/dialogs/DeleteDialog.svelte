<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import { describeTrashConfirmation } from "../trash/trash-messages";

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

  const copy = $derived(
    describeTrashConfirmation({
      name: itemName,
      kind: itemKind,
      itemCount,
      shareCount,
      revoking,
    }),
  );
  const toTrash = $derived(itemKind === "note" || (itemKind === "folder" && itemCount > 0));
</script>

<Dialog open={true} title={copy.title} onClose={() => !revoking && onClose()}>
  {#snippet children()}
    <p>{copy.body}</p>
    {#if copy.shareWarning !== null}
      <p class="share-warning" data-testid="trash-share-warning">
        {copy.shareWarning}
      </p>
    {/if}
    {#if copy.retentionNote !== null}
      <p class="trash-note">{copy.retentionNote}</p>
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
      {copy.confirmLabel}
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
