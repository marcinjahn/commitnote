<script lang="ts">
  import Dialog from "../dialogs/Dialog.svelte";

  interface Props {
    open: boolean;
    checking: boolean;
    error: string | null;
    onSubmit: (accessToken: string) => void;
    onLogOut: () => void;
  }

  const { open, checking, error, onSubmit, onLogOut }: Props = $props();

  const uid = $props.id();
  const formId = `token-dialog-form-${uid}`;
  const inputId = `token-dialog-input-${uid}`;

  let accessToken = $state("");

  const canSubmit = $derived(!checking && accessToken.trim() !== "");

  $effect(() => {
    if (!open) accessToken = "";
  });

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(accessToken);
  }
</script>

<Dialog {open} title="Access token needed" onClose={() => {}}>
  {#snippet children()}
    <p>
      The notes repo rejected the access token, or it no longer has access.
      Enter a new access token to keep saving. Your unsaved changes are kept.
    </p>
    <form id={formId} onsubmit={handleSubmit}>
      <div class="field">
        <label for={inputId}>Access token</label>
        <input
          id={inputId}
          type="password"
          autocomplete="off"
          bind:value={accessToken}
          disabled={checking}
        />
      </div>
    </form>
    {#if checking}
      <p role="status">Checking access token…</p>
    {/if}
    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}
  {/snippet}
  {#snippet actions()}
    <button
      type="submit"
      form={formId}
      class="button button-primary"
      disabled={!canSubmit}
    >
      Continue
    </button>
    <button type="button" class="button button-ghost" onclick={onLogOut}>
      Log out
    </button>
  {/snippet}
</Dialog>
