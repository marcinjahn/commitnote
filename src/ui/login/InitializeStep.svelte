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
    changed or recovered later.
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
    gap: var(--space-3);
  }

  form {
    display: grid;
    gap: var(--space-3);
  }

  .step-progress {
    display: grid;
    gap: var(--space-1);
  }

  .step-progress progress {
    width: 100%;
  }

  .initialize-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
