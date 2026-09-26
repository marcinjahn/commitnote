<script lang="ts">
  import type { LoginStep } from "../../login/login";
  import { describeLoginStep } from "./login-messages";

  interface Props {
    busy: boolean;
    step: LoginStep | null;
    error: string | null;
    onConfirm: (repeatedPassphrase: string) => void;
    onCancel: () => void;
  }

  const { busy, step, error, onConfirm, onCancel }: Props = $props();

  let repeatedPassphrase = $state("");

  const stepLabel = $derived(describeLoginStep(step ?? "checkingRepository"));

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    onConfirm(repeatedPassphrase);
  }
</script>

<div class="initialize-step">
  <h2>Initialize this repository?</h2>
  <p class="notice">
    This repository is empty. commitnote will make it a notes repo by adding
    one configuration file. Your passphrase encrypts everything and cannot be
    recovered if you forget it.
  </p>

  <form onsubmit={handleSubmit}>
    <div class="field">
      <label for="initialize-repeat-passphrase">Repeat passphrase</label>
      <input
        id="initialize-repeat-passphrase"
        type="password"
        autocomplete="new-password"
        bind:value={repeatedPassphrase}
        disabled={busy}
        aria-describedby="initialize-passphrase-hint"
      />
      <p id="initialize-passphrase-hint" class="field-hint">
        Use a long passphrase, for example several random words. It cannot be
        recovered.
      </p>
    </div>

    {#if busy}
      <div role="status" class="step-progress">
        <progress></progress>
        <span>{stepLabel}</span>
      </div>
    {/if}

    {#if error !== null}
      <p role="alert" class="alert-error">{error}</p>
    {/if}

    <div class="initialize-actions">
      <button type="submit" class="button button-primary" disabled={busy}>
        Initialize notes repo
      </button>
      <button
        type="button"
        class="button button-ghost"
        onclick={onCancel}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
  </form>
</div>

<style>
  .initialize-step {
    display: grid;
    gap: var(--space-4);
  }

  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--letter-spacing-tight);
  }

  form {
    display: grid;
    gap: var(--space-4);
  }

  .step-progress {
    display: grid;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .step-progress progress {
    width: 100%;
    height: var(--space-1);
    accent-color: var(--color-ink);
  }

  .initialize-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
