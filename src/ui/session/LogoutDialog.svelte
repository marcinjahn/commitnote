<script lang="ts">
  import Dialog from "../dialogs/Dialog.svelte";
  import {
    describeLogoutUnsaved,
    KEEP_TRYING_LABEL,
    LOG_OUT_ANYWAY_LABEL,
    LOGGING_OUT_TITLE,
    LOGOUT_SAVING_TEXT,
    LOGOUT_UNSAVED_TITLE,
  } from "./session-messages";

  interface Props {
    open: boolean;
    saving: boolean;
    unsavedCount: number;
    onKeepTrying: () => void;
    onLogOutAnyway: () => void;
  }

  const { open, saving, unsavedCount, onKeepTrying, onLogOutAnyway }: Props =
    $props();

  const message = $derived(describeLogoutUnsaved(unsavedCount));
</script>

<Dialog
  {open}
  title={saving ? LOGGING_OUT_TITLE : LOGOUT_UNSAVED_TITLE}
  onClose={() => {}}
  swipeToClose={false}
>
  {#snippet children()}
    {#if saving}
      <p role="status" class="status">{LOGOUT_SAVING_TEXT}</p>
    {:else}
      <p>{message}</p>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if !saving}
      <button type="button" class="button button-primary" onclick={onKeepTrying}>
        {KEEP_TRYING_LABEL}
      </button>
      <button type="button" class="button button-danger" onclick={onLogOutAnyway}>
        {LOG_OUT_ANYWAY_LABEL}
      </button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .status {
    color: var(--color-text-muted);
  }
</style>
