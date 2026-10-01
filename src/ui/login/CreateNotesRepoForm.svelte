<script lang="ts">
  import type { Snippet } from "svelte";
  import PasswordManagerUsername from "./PasswordManagerUsername.svelte";
  import PassphraseStrength from "./PassphraseStrength.svelte";

  interface Props {
    username: string;
    description: string;
    busy: boolean;
    passphrase: string;
    repeatedPassphrase: string;
    mismatch: boolean;
    onsubmit: () => void;
    children: Snippet;
  }

  let {
    username,
    description,
    busy,
    passphrase = $bindable(),
    repeatedPassphrase = $bindable(),
    mismatch,
    onsubmit,
    children,
  }: Props = $props();

  let passphraseInput = $state<HTMLInputElement | null>(null);

  export function focus(): void {
    passphraseInput?.focus();
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    onsubmit();
  }
</script>

<form class="passphrase-form" onsubmit={handleSubmit}>
  <p class="setup-description">{description}</p>

  <PasswordManagerUsername {username} />

  <div class="field">
    <label for="login-create-passphrase">Create passphrase</label>
    <input
      id="login-create-passphrase"
      type="password"
      autocomplete="new-password"
      bind:this={passphraseInput}
      bind:value={passphrase}
      disabled={busy}
      aria-describedby="login-create-passphrase-hint login-create-passphrase-strength"
    />
    <p id="login-create-passphrase-hint" class="field-hint">
      Use a long passphrase, for example several random words. It encrypts
      your notes and cannot be recovered if you forget it.
    </p>
    <PassphraseStrength
      id="login-create-passphrase-strength"
      {passphrase}
      repositoryLabel={username}
    />
  </div>

  <div class="field">
    <label for="login-repeat-passphrase">Repeat passphrase</label>
    <input
      id="login-repeat-passphrase"
      type="password"
      autocomplete="new-password"
      bind:value={repeatedPassphrase}
      disabled={busy}
      aria-invalid={mismatch}
      aria-describedby={mismatch ? "login-repeat-passphrase-error" : undefined}
    />
    {#if mismatch}
      <p id="login-repeat-passphrase-error" role="alert" class="field-error">
        Passphrases do not match.
      </p>
    {/if}
  </div>

  {@render children()}

  <button type="submit" class="button button-primary" disabled={busy}>
    Set up notes repo
  </button>
</form>

<style>
  form {
    display: grid;
    gap: var(--space-4);
  }

  form > .button-primary {
    width: 100%;
  }

  .field-error {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .setup-description {
    margin: 0;
    font-size: var(--font-size-sm);
  }
</style>
