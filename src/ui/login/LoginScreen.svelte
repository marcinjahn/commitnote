<script lang="ts">
  import type {
    LoginError,
    LoginInput,
    LoginResult,
    LoginStep,
    PendingInitialization,
  } from "../../login/login";
  import type { Session } from "../../session/session";
  import type { ForgeAdapter } from "../../forge/forge-adapter";
  import { untrack } from "svelte";
  import {
    describeLoginError,
    describeLoginStep,
    GENERIC_LOGIN_ERROR,
  } from "./login-messages";
  import InitializeStep from "./InitializeStep.svelte";
  import Wordmark from "../wordmark/Wordmark.svelte";

  interface Props {
    initialRepoUrl: string;
    initialError?: LoginError | null;
    logIn: (
      input: LoginInput,
      onStep: (step: LoginStep) => void,
    ) => Promise<LoginResult>;
    initialize: (
      pending: PendingInitialization,
      passphrase: string,
      onStep: (step: LoginStep) => void,
    ) => Promise<LoginResult>;
    onLoggedIn: (result: {
      session: Session;
      adapter: ForgeAdapter;
      rememberMe: boolean;
    }) => void;
  }

  const {
    initialRepoUrl,
    initialError = null,
    logIn,
    initialize,
    onLoggedIn,
  }: Props = $props();

  let mode = $state<"login" | "initialize">("login");
  let repoUrl = $state(untrack(() => initialRepoUrl));
  let accessToken = $state("");
  let passphrase = $state("");
  let rememberMe = $state(false);
  let pending = $state<PendingInitialization | null>(null);

  let busy = $state(false);
  let step = $state<LoginStep | null>(null);
  let error = $state<string | null>(
    untrack(() => (initialError ? describeLoginError(initialError) : null)),
  );

  const stepLabel = $derived(describeLoginStep(step ?? "checkingRepository"));

  function handleResult(result: LoginResult): void {
    switch (result.kind) {
      case "loggedIn":
        onLoggedIn({
          session: result.session,
          adapter: result.adapter,
          rememberMe,
        });
        break;
      case "needsInitialization":
        pending = result.pending;
        mode = "initialize";
        error = null;
        break;
      case "failed":
        error = describeLoginError(result.error);
        if (result.error.kind === "wrongPassphrase") {
          passphrase = "";
        }
        break;
    }
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (repoUrl.trim() === "") {
      error = "Enter the repo URL.";
      return;
    }
    if (accessToken.trim() === "") {
      error = "Enter the access token.";
      return;
    }
    if (passphrase.trim() === "") {
      error = "Enter the passphrase.";
      return;
    }

    error = null;
    step = null;
    busy = true;
    try {
      const result = await logIn({ repoUrl, accessToken, passphrase }, (s) => {
        step = s;
      });
      handleResult(result);
    } catch (e) {
      console.error(e);
      error = GENERIC_LOGIN_ERROR;
    } finally {
      busy = false;
    }
  }

  async function handleInitializeConfirm(
    repeatedPassphrase: string,
  ): Promise<void> {
    if (pending === null) return;
    if (repeatedPassphrase !== passphrase) {
      error = "Passphrases do not match.";
      return;
    }

    error = null;
    step = null;
    busy = true;
    try {
      const result = await initialize(pending, passphrase, (s) => {
        step = s;
      });
      handleResult(result);
    } catch (e) {
      console.error(e);
      error = GENERIC_LOGIN_ERROR;
    } finally {
      busy = false;
    }
  }

  function handleInitializeCancel(): void {
    mode = "login";
    pending = null;
    error = null;
    step = null;
    busy = false;
  }
</script>

<div class="login-shell">
  <div class="login-card">
    <Wordmark element="h1" />
    <p class="login-tagline">
      Encrypted markdown notes in your own git repository.
    </p>

    {#if mode === "login"}
      <form onsubmit={handleSubmit}>
        <div class="field">
          <label for="login-repo-url">Repo URL</label>
          <input
            id="login-repo-url"
            type="text"
            autocomplete="url"
            inputmode="url"
            placeholder="https://github.com/you/notes"
            bind:value={repoUrl}
            disabled={busy}
          />
        </div>

        <div class="field">
          <label for="login-access-token">Access token</label>
          <input
            id="login-access-token"
            type="password"
            autocomplete="off"
            bind:value={accessToken}
            disabled={busy}
            aria-describedby="login-access-token-hint"
          />
          <p id="login-access-token-hint" class="field-hint">
            A fine-grained token for this repository only, with "Contents:
            read and write".
          </p>
        </div>

        <div class="field">
          <label for="login-passphrase">Passphrase</label>
          <input
            id="login-passphrase"
            type="password"
            autocomplete="current-password"
            bind:value={passphrase}
            disabled={busy}
            aria-describedby="login-passphrase-hint"
          />
          <p id="login-passphrase-hint" class="field-hint">
            Use a long passphrase, for example several random words. It
            cannot be recovered.
          </p>
        </div>

        <div>
          <label class="checkbox-field">
            <input
              type="checkbox"
              bind:checked={rememberMe}
              disabled={busy}
              aria-describedby="login-remember-me-hint"
            />
            Remember me
          </label>
          <p id="login-remember-me-hint" class="field-hint">
            Keeps your access token and keys in this browser until you log
            out. Use only on your own device.
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

        <button type="submit" class="button button-primary" disabled={busy}>
          Log in
        </button>
      </form>
    {:else}
      <InitializeStep
        {busy}
        {step}
        {error}
        onConfirm={handleInitializeConfirm}
        onCancel={handleInitializeCancel}
      />
    {/if}
  </div>
</div>

<style>
  .login-shell {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-background);
    padding: var(--space-5) var(--space-4);
  }

  .login-card {
    width: 100%;
    max-width: var(--login-card-width);
    display: grid;
    gap: var(--space-4);
    background: var(--color-surface-raised);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius);
    padding: var(--space-5);
    box-shadow: var(--shadow-2);
  }

  .login-tagline {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
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

  form > .button-primary {
    width: 100%;
  }

  @media (max-width: 767px) {
    .login-shell {
      padding: var(--space-4) var(--space-3);
    }

    .login-card {
      border: none;
      box-shadow: none;
    }
  }
</style>
