<script lang="ts">
  import Dialog from "./Dialog.svelte";

  interface Props {
    title: string;
    body: string;
    confirmLabel: string;
    /** Set while the confirmed action runs; the dialog can't be dismissed meanwhile. */
    busyLabel?: string | null;
    onConfirm: () => void;
    onClose: () => void;
  }

  const {
    title,
    body,
    confirmLabel,
    busyLabel = null,
    onConfirm,
    onClose,
  }: Props = $props();

  const busy = $derived(busyLabel !== null);
</script>

<Dialog open={true} {title} onClose={() => !busy && onClose()}>
  {#snippet children()}
    <p>{body}</p>
  {/snippet}
  {#snippet actions()}
    <button
      type="button"
      class="button button-ghost"
      disabled={busy}
      onclick={onClose}
    >
      Cancel
    </button>
    <button
      type="button"
      class="button button-danger"
      disabled={busy}
      onclick={onConfirm}
    >
      {busyLabel ?? confirmLabel}
    </button>
  {/snippet}
</Dialog>
