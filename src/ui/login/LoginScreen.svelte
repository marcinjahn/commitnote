<script lang="ts">
  import type {
    LoginError,
    LoginInput,
    LoginResult,
    LoginStep,
    PendingInitialization,
  } from "../../login/login";
  import { listRepositories, repositoryLabel } from "../../login/login";
  import type { Session } from "../../session/session";
  import type { ForgeAdapter } from "../../forge/forge-adapter";
  import type { ForgeId } from "../../forge/repo-coordinates";
  import type {
    ForgeProvider,
    RepositorySummary,
  } from "../../forge/forge-provider";
  import { tick, untrack } from "svelte";
  import {
    describeLoginError,
    describeLoginStep,
    GENERIC_LOGIN_ERROR,
  } from "./login-messages";
  import InitializeStep from "./InitializeStep.svelte";
  import Wordmark from "../wordmark/Wordmark.svelte";

  interface Props {
    providers: readonly ForgeProvider[];
    initialRepoUrl: string;
    initialForgeId?: string | null;
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
    providers,
    initialRepoUrl,
    initialForgeId = null,
    initialError = null,
    logIn,
    initialize,
    onLoggedIn,
  }: Props = $props();

  let mode = $state<"login" | "initialize">("login");
  let providerId = $state(
    untrack(() => (providers.find((p) => p.id === initialForgeId) ?? providers[0]).id),
  );
  let accessToken = $state("");
  let repositories = $state.raw<RepositorySummary[] | null>(null);
  let selectedRepoUrl = $state("");
  let passphrase = $state("");
  let rememberMe = $state(false);
  let pending = $state.raw<PendingInitialization | null>(null);

  let busy = $state(false);
  let step = $state<LoginStep | null>(null);
  let error = $state<string | null>(
    untrack(() =>
      initialError
        ? describeLoginError(
            initialError,
            (providers.find((p) => p.id === initialForgeId) ?? providers[0])
              .name,
          )
        : null,
    ),
  );

  let repositorySelect = $state<HTMLSelectElement | null>(null);
  let passphraseInput = $state<HTMLInputElement | null>(null);

  const provider = $derived(
    providers.find((p) => p.id === providerId) ?? providers[0],
  );
  const tokenCreationUrl = $derived(
    provider.accessTokenCreationUrl(new Date()),
  );
  const stepLabel = $derived(describeLoginStep(step ?? "checkingRepository"));

  function forgetRepositories(): void {
    repositories = null;
    selectedRepoUrl = "";
  }

  function selectProvider(id: ForgeId): void {
    if (id === providerId) return;
    providerId = id;
    accessToken = "";
    passphrase = "";
    error = null;
    forgetRepositories();
  }

  function preselectedRepoUrl(listed: readonly RepositorySummary[]): string {
    const remembered = listed.find(
      (r) => r.url.toLowerCase() === initialRepoUrl.trim().toLowerCase(),
    );
    if (remembered) return remembered.url;
    return listed.length === 1 ? listed[0].url : "";
  }

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
        error = describeLoginError(result.error, provider.name);
        if (result.error.kind === "wrongPassphrase") {
          passphrase = "";
        }
        break;
    }
  }

  async function run(action: () => Promise<void>): Promise<void> {
    error = null;
    step = null;
    busy = true;
    try {
      await action();
    } catch (e) {
      console.error(e);
      error = GENERIC_LOGIN_ERROR;
    } finally {
      busy = false;
    }
  }

  async function loadRepositories(): Promise<void> {
    step = "listingRepositories";
    const result = await listRepositories(provider, accessToken);
    if (result.kind === "failed") {
      error = describeLoginError(result.error, provider.name);
      return;
    }
    if (result.repositories.length === 0) {
      error = `This access token has no access to any repository. Edit it on ${provider.name} and add your notes repository.`;
      return;
    }
    repositories = result.repositories;
    selectedRepoUrl = preselectedRepoUrl(result.repositories);
    await tick();
    if (selectedRepoUrl === "") {
      repositorySelect?.focus();
    } else {
      passphraseInput?.focus();
    }
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (accessToken.trim() === "") {
      error = "Enter the access token.";
      return;
    }
    if (repositories === null) {
      await run(loadRepositories);
      return;
    }

    const repository = repositories.find((r) => r.url === selectedRepoUrl);
    if (repository === undefined) {
      error = "Choose a repository.";
      return;
    }
    if (passphrase.trim() === "") {
      error = "Enter the passphrase.";
      return;
    }

    await run(async () => {
      const result = await logIn(
        { repository, accessToken, passphrase },
        (s) => {
          step = s;
        },
      );
      handleResult(result);
    });
  }

  async function handleInitializeConfirm(
    repeatedPassphrase: string,
  ): Promise<void> {
    if (pending === null) return;
    if (repeatedPassphrase !== passphrase) {
      error = "Passphrases do not match.";
      return;
    }

    const toInitialize = pending;
    await run(async () => {
      const result = await initialize(toInitialize, passphrase, (s) => {
        step = s;
      });
      handleResult(result);
    });
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
        {#if providers.length > 1}
          <fieldset class="provider-picker" disabled={busy}>
            <legend>Git host</legend>
            <div class="provider-options">
              {#each providers as option (option.id)}
                <label class="provider-option">
                  <input
                    type="radio"
                    name="login-forge"
                    value={option.id}
                    checked={option.id === providerId}
                    onchange={() => selectProvider(option.id)}
                  />
                  <span>{option.name}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}

        <div class="field">
          <label for="login-access-token">Access token</label>
          <input
            id="login-access-token"
            type="password"
            autocomplete="off"
            bind:value={accessToken}
            oninput={forgetRepositories}
            disabled={busy}
            aria-describedby="login-access-token-hint"
          />
          <p id="login-access-token-hint" class="field-hint">
            {provider.accessTokenHint ??
              "An access token for your notes repository only, with read and write access to its contents."}
            <a href={tokenCreationUrl} target="_blank" rel="noopener noreferrer"
              >Create a token on {provider.name}</a
            > with these settings filled in, then choose the repository there.
          </p>
        </div>

        {#if repositories !== null}
          <div class="field">
            <label for="login-repository">Repository</label>
            <select
              id="login-repository"
              bind:this={repositorySelect}
              bind:value={selectedRepoUrl}
              disabled={busy}
              aria-describedby="login-repository-hint"
            >
              {#if selectedRepoUrl === ""}
                <option value="" disabled>Choose a repository</option>
              {/if}
              {#each repositories as repository (repository.url)}
                <option value={repository.url}>
                  {repositoryLabel(repository.coordinates)}
                </option>
              {/each}
            </select>
            <p id="login-repository-hint" class="field-hint">
              Repositories this access token can open. Pick an empty one to
              start a new notes repo.
            </p>
          </div>

          <div class="field">
            <label for="login-passphrase">Passphrase</label>
            <input
              id="login-passphrase"
              type="password"
              autocomplete="current-password"
              bind:this={passphraseInput}
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
        {/if}

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
          {repositories === null ? "Continue" : "Log in"}
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
  }

  .provider-picker {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
  }

  .provider-picker legend {
    padding: 0;
    margin-bottom: var(--space-1);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  .provider-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: var(--space-1);
  }

  .provider-option {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: var(--hairline) solid var(--color-border-strong);
    border-radius: var(--radius);
    background: var(--color-surface-raised);
    font-weight: var(--font-weight-medium);
    text-align: center;
    overflow-wrap: anywhere;
    cursor: pointer;
    transition:
      background-color var(--motion-duration) var(--motion-easing),
      border-color var(--motion-duration) var(--motion-easing);
  }

  .provider-option:hover {
    border-color: var(--color-text);
  }

  .provider-option:has(input:checked) {
    background: var(--color-ink);
    border-color: var(--color-ink);
    color: var(--color-on-ink);
  }

  .provider-option:has(input:focus-visible) {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .provider-option input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  fieldset:disabled .provider-option {
    cursor: default;
    opacity: 0.6;
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
