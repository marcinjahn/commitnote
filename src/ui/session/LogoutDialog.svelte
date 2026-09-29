<script lang="ts">
  import Dialog from "../dialogs/Dialog.svelte";

  interface Props {
    open: boolean;
    saving: boolean;
    unsavedCount: number;
    onKeepTrying: () => void;
    onLogOutAnyway: () => void;
  }

  const { open, saving, unsavedCount, onKeepTrying, onLogOutAnyway }: Props =
    $props();

  const message = $derived(
    `${unsavedCount} ${unsavedCount === 1 ? "note or folder is" : "notes or folders are"} not saved yet. If you log out now, these changes are lost.`,
  );
</script>

<Dialog
  {open}
  title={saving ? "Logging out" : "Some changes are not saved"}
  onClose={() => {}}
>
  {#snippet children()}
    {#if saving}
      <p role="status">Saving…</p>
    {:else}
      <p>{message}</p>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if !saving}
      <button type="button" class="button button-primary" onclick={onKeepTrying}>
        Keep trying
      </button>
      <button type="button" class="button button-danger" onclick={onLogOutAnyway}>
        Log out anyway
      </button>
    {/if}
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
