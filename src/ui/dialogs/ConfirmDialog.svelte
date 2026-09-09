<script lang="ts">
  import Dialog from "./Dialog.svelte";

  interface Props {
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void;
    onClose: () => void;
  }

  const { open, title, body, confirmLabel, onConfirm, onClose }: Props = $props();
</script>

<Dialog {open} {title} {onClose}>
  {#snippet children()}
    <p>{body}</p>
  {/snippet}
  {#snippet actions()}
    <button type="button" class="button button-ghost" onclick={onClose}>
      Cancel
    </button>
    <button type="button" class="button button-danger" onclick={onConfirm}>
      {confirmLabel}
    </button>
  {/snippet}
</Dialog>
