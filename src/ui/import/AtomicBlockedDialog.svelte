<script lang="ts">
  import Dialog from "../dialogs/Dialog.svelte";
  import {
    describeAtomicSetup,
    ENABLE_ATOMIC_LABEL,
    IMPORT_BLOCKED_KEPT,
    SAVE_WITHOUT_ATOMIC_HINT,
  } from "./import-messages";

  interface Props {
    forgeName: string;
    canConfigure: boolean;
    onEnable: () => Promise<string | null>;
    onSaveWithoutAtomic: () => void;
    onClose: () => void;
  }

  const {
    forgeName,
    canConfigure,
    onEnable,
    onSaveWithoutAtomic,
    onClose,
  }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function handleEnable(): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      error = await onEnable();
    } finally {
      busy = false;
    }
  }

  function handleClose(): void {
    if (!busy) onClose();
  }
</script>

<Dialog open={true} title="Import not saved" onClose={handleClose} closeButton={true} swipeToClose={!busy}>
  {#snippet children()}
    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}
    <p>{describeAtomicSetup(forgeName, canConfigure)}</p>
    <p class="field-hint">{IMPORT_BLOCKED_KEPT}</p>
    <p class="field-hint">{SAVE_WITHOUT_ATOMIC_HINT}</p>
  {/snippet}
  {#snippet actions()}
    {#if canConfigure}
      <button
        type="button"
        class="button button-primary"
        disabled={busy}
        onclick={() => void handleEnable()}
      >
        {ENABLE_ATOMIC_LABEL}
      </button>
    {/if}
    <button
      type="button"
      class="button"
      disabled={busy}
      onclick={onSaveWithoutAtomic}
    >
      Save without it
    </button>
  {/snippet}
</Dialog>
