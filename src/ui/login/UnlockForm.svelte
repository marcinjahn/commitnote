<script lang="ts">
  import type { Snippet } from "svelte";
  import PasswordManagerUsername from "./PasswordManagerUsername.svelte";

  interface Props {
    username: string;
    busy: boolean;
    invalid: boolean;
    passphrase: string;
    onsubmit: () => void;
    children: Snippet;
  }

  let {
    username,
    busy,
    invalid,
    passphrase = $bindable(),
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

<form onsubmit={handleSubmit}>
  <PasswordManagerUsername {username} />

  <div class="field">
    <label for="login-passphrase">Passphrase</label>
    <input
      id="login-passphrase"
      type="password"
      autocomplete="current-password"
      bind:this={passphraseInput}
      bind:value={passphrase}
      disabled={busy}
      aria-invalid={invalid ? "true" : undefined}
      aria-describedby={invalid ? "login-form-error" : undefined}
    />
  </div>

  {@render children()}

  <button type="submit" class="button button-primary" disabled={busy}>
    Log in
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
</style>
