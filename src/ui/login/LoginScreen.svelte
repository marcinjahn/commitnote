<script lang="ts">
  import type {
    LoginError,
    LoginResult,
    LoginStep,
    NotesRepoTarget,
    PendingInitialization,
    RepositoryListResult,
    RepositoryState,
    UnlockResult,
  } from "../../login/login";
  import {
    isTransient,
    listRepositories,
    repositoryLabel,
  } from "../../login/login";
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
    describeSetUp,
    GENERIC_LOGIN_ERROR,
    PUBLIC_REPOSITORY_WARNING,
  } from "./login-messages";
  import { resolveSettings, SETTINGS_SCHEMA } from "../../settings/settings";
  import type { AccentColorId } from "../../settings/accent-palette";
  import UnlockForm from "./UnlockForm.svelte";
  import CreateNotesRepoForm from "./CreateNotesRepoForm.svelte";
  import Wordmark from "../wordmark/Wordmark.svelte";

  interface Props {
    providers: readonly ForgeProvider[];
    initialRepoUrl: string;
    initialForgeId?: string | null;
    initialError?: LoginError | null;
    inspect: (
      repository: RepositorySummary,
      accessToken: string,
    ) => Promise<RepositoryState>;
    unlock: (
      target: NotesRepoTarget,
      passphrase: string,
      onStep: (step: LoginStep) => void,
    ) => Promise<UnlockResult>;
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
    onAccentColor: (id: AccentColorId) => void;
  }

  const {
    providers,
    initialRepoUrl,
    initialForgeId = null,
    initialError = null,
    inspect,
    unlock,
    initialize,
    onLoggedIn,
    onAccentColor,
  }: Props = $props();

  type TokenError =
    | { readonly kind: "message"; readonly text: string }
    | { readonly kind: "noRepositories" };

  /** `error: null` stands for an unexpected failure. */
  type Inspection =
    | { readonly kind: "checking" }
    | Exclude<RepositoryState, { kind: "unusable" }>
    | { readonly kind: "unusable"; readonly error: LoginError | null };

  let providerId = $state(
    untrack(
      () => (providers.find((p) => p.id === initialForgeId) ?? providers[0]).id,
    ),
  );
  let accessToken = $state("");
  let repositories = $state.raw<RepositorySummary[] | null>(null);
  let selectedRepoUrl = $state("");
  let listing = $state(false);
  let tokenError = $state.raw<TokenError | null>(
    untrack(() =>
      initialError
        ? {
            kind: "message",
            text: describeLoginError(
              initialError,
              (providers.find((p) => p.id === initialForgeId) ?? providers[0])
                .name,
            ),
          }
        : null,
    ),
  );

  let inspection = $state.raw<Inspection | null>(null);

  $effect(() => {
    onAccentColor(
      inspection?.kind === "notesRepo"
        ? resolveSettings(SETTINGS_SCHEMA, inspection.target.config.settings)
            .accentColor
        : "system",
    );
  });
  let inspectedRepository = $state.raw<RepositorySummary | null>(null);
  let inspectionRun = 0;

  let passphrase = $state("");
  let repeatedPassphrase = $state("");
  let passphrasesDiffer = $state(false);
  let rememberMe = $state(false);
  let submitting = $state(false);
  let step = $state<LoginStep | null>(null);
  let formError = $state<string | null>(null);

  let repositorySelect = $state<HTMLSelectElement | null>(null);
  let passphraseForm = $state<{ focus(): void } | null>(null);

  const provider = $derived(
    providers.find((p) => p.id === providerId) ?? providers[0],
  );
  const tokenCreationUrl = $derived(
    provider.accessTokenCreationUrl(new Date()),
  );
  const repositoryCreationUrl = $derived(provider.repositoryCreationUrl());
  const username = $derived(
    inspectedRepository === null
      ? ""
      : repositoryLabel(inspectedRepository.coordinates),
  );

  function resetInspection(): void {
    inspectionRun++;
    inspection = null;
    inspectedRepository = null;
    passphrase = "";
    repeatedPassphrase = "";
    passphrasesDiffer = false;
    formError = null;
    step = null;
  }

  function forgetRepositories(): void {
    repositories = null;
    selectedRepoUrl = "";
    resetInspection();
  }

  function selectProvider(id: ForgeId): void {
    if (id === providerId) return;
    providerId = id;
    accessToken = "";
    tokenError = null;
    forgetRepositories();
  }

  function preselectedRepoUrl(listed: readonly RepositorySummary[]): string {
    const remembered = listed.find(
      (r) => r.url.toLowerCase() === initialRepoUrl.trim().toLowerCase(),
    );
    if (remembered) return remembered.url;
    return listed.length === 1 ? listed[0].url : "";
  }

  function canMoveFocus(): boolean {
    const active = document.activeElement;
    return (
      active === null || active === document.body || active === repositorySelect
    );
  }

  async function inspectSelected(): Promise<void> {
    const repository = repositories?.find((r) => r.url === selectedRepoUrl);
    if (repository === undefined) return;
    resetInspection();
    const run = inspectionRun;
    inspection = { kind: "checking" };
    inspectedRepository = repository;

    let state: Inspection;
    try {
      state = await inspect(repository, accessToken);
    } catch (e) {
      console.error(e);
      state = { kind: "unusable", error: null };
    }
    if (run !== inspectionRun) return;
    inspection = state;

    await tick();
    if (run !== inspectionRun || !canMoveFocus()) return;
    if (state.kind === "unusable") {
      repositorySelect?.focus();
    } else {
      passphraseForm?.focus();
    }
  }

  function handleRepositoryChange(event: Event): void {
    selectedRepoUrl = (event.currentTarget as HTMLSelectElement).value;
    void inspectSelected();
  }

  async function handleTokenSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (accessToken.trim() === "") {
      tokenError = { kind: "message", text: "Enter the access token." };
      return;
    }

    forgetRepositories();
    tokenError = null;
    listing = true;
    let result: RepositoryListResult;
    try {
      result = await listRepositories(provider, accessToken);
    } catch (e) {
      console.error(e);
      tokenError = { kind: "message", text: GENERIC_LOGIN_ERROR };
      return;
    } finally {
      listing = false;
    }

    if (result.kind === "failed") {
      tokenError = {
        kind: "message",
        text: describeLoginError(result.error, provider.name),
      };
      return;
    }
    if (result.repositories.length === 0) {
      tokenError = { kind: "noRepositories" };
      return;
    }

    repositories = result.repositories;
    selectedRepoUrl = preselectedRepoUrl(result.repositories);
    await tick();
    repositorySelect?.focus();
    if (selectedRepoUrl !== "") {
      void inspectSelected();
    }
  }

  async function submit(action: () => Promise<UnlockResult>): Promise<void> {
    formError = null;
    step = null;
    submitting = true;
    let result: UnlockResult;
    try {
      result = await action();
    } catch (e) {
      console.error(e);
      formError = GENERIC_LOGIN_ERROR;
      return;
    } finally {
      submitting = false;
    }

    if (result.kind === "loggedIn") {
      onLoggedIn({
        session: result.session,
        adapter: result.adapter,
        rememberMe,
      });
      return;
    }

    if (result.error.kind === "wrongPassphrase") {
      if (result.target !== undefined) {
        inspection = { kind: "notesRepo", target: result.target };
      }
      formError = describeLoginError(result.error, provider.name);
      passphrase = "";
      await tick();
      passphraseForm?.focus();
    } else if (isTransient(result.error)) {
      formError = describeLoginError(result.error, provider.name);
    } else {
      inspection = { kind: "unusable", error: result.error };
    }
  }

  function onStep(s: LoginStep): void {
    step = s;
  }

  async function handleUnlock(): Promise<void> {
    if (inspection?.kind !== "notesRepo") return;
    if (passphrase.trim() === "") {
      formError = "Enter the passphrase.";
      return;
    }
    const { target } = inspection;
    const entered = passphrase;
    await submit(() => unlock(target, entered, onStep));
  }

  async function handleSetUp(): Promise<void> {
    if (inspection?.kind !== "uninitialized") return;
    passphrasesDiffer = false;
    if (passphrase.trim() === "") {
      formError = "Create a passphrase.";
      return;
    }
    if (repeatedPassphrase !== passphrase) {
      formError = null;
      passphrasesDiffer = true;
      return;
    }
    const { pending } = inspection;
    const entered = passphrase;
    await submit(() => initialize(pending, entered, onStep));
  }

  function canCheckAgain(error: LoginError | null): boolean {
    return error?.kind !== "unauthorized";
  }
</script>

{#snippet newRepositoryNote()}
  No notes repo yet?
  <a href={repositoryCreationUrl} target="_blank" rel="noopener noreferrer"
    >Create an empty private repository</a
  > first, then give the token access to it.
{/snippet}

{#snippet progress(label: string)}
  <div role="status" class="step-progress">
    <progress></progress>
    <span>{label}</span>
  </div>
{/snippet}

{#snippet passphraseFormFooter()}
  <div>
    <label class="checkbox-field">
      <input
        type="checkbox"
        bind:checked={rememberMe}
        disabled={submitting}
        aria-describedby="login-remember-me-hint"
      />
      Remember me
    </label>
    <p id="login-remember-me-hint" class="field-hint">
      Keeps your access token and keys in this browser until you log out. Use
      only on your own device.
    </p>
  </div>

  {#if submitting}
    {@render progress(describeLoginStep(step ?? "derivingKeys"))}
  {/if}

  {#if formError !== null}
    <p role="alert" class="alert-error">{formError}</p>
  {/if}
{/snippet}

<div class="login-shell">
  <div class="login-card">
    <Wordmark element="h1" />
    <p class="login-tagline">
      Encrypted markdown notes in your own git repository.
    </p>

    <form onsubmit={handleTokenSubmit}>
      {#if providers.length > 1}
        <fieldset class="provider-picker" disabled={listing || submitting}>
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
          disabled={listing || submitting}
          aria-describedby="login-access-token-hint"
        />
        <p id="login-access-token-hint" class="field-hint">
          {provider.accessTokenHint ??
            "An access token for your notes repository only, with read and write access to its contents."}
          <a href={tokenCreationUrl} target="_blank" rel="noopener noreferrer"
            >Create a token on {provider.name}</a
          > with these settings filled in, then choose the repository there.
        </p>
        <p class="field-hint">{@render newRepositoryNote()}</p>
      </div>

      {#if listing}
        {@render progress(describeLoginStep("listingRepositories"))}
      {/if}

      {#if tokenError?.kind === "message"}
        <p role="alert" class="alert-error">{tokenError.text}</p>
      {:else if tokenError?.kind === "noRepositories"}
        <div role="alert" class="alert-error">
          <p>
            This access token has no access to any repository. Edit it on {provider.name}
            and add your notes repository.
          </p>
          <p>{@render newRepositoryNote()}</p>
        </div>
      {/if}

      {#if repositories === null}
        <button type="submit" class="button button-primary" disabled={listing}>
          Continue
        </button>
      {/if}
    </form>

    {#if repositories !== null}
      <div class="field">
        <label for="login-repository">Repository</label>
        <select
          id="login-repository"
          bind:this={repositorySelect}
          bind:value={selectedRepoUrl}
          onchange={handleRepositoryChange}
          disabled={submitting}
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
          Repositories this access token can open. Pick your notes repo, or an
          empty one to start a new notes repo.
        </p>
      </div>
    {/if}

    {#if inspection?.kind === "checking"}
      {@render progress(describeLoginStep("checkingRepository"))}
    {:else if inspection?.kind === "unusable"}
      <div class="repository-problem">
        <p role="alert" class="alert-error">
          {inspection.error === null
            ? GENERIC_LOGIN_ERROR
            : describeLoginError(inspection.error, provider.name)}
        </p>
        {#if inspection.error?.kind === "foreign"}
          <p class="field-hint">
            To start a new notes repo,
            <a
              href={repositoryCreationUrl}
              target="_blank"
              rel="noopener noreferrer">create an empty private repository</a
            > and give the token access to it.
          </p>
        {/if}
        {#if canCheckAgain(inspection.error)}
          <button type="button" class="button" onclick={inspectSelected}>
            Check again
          </button>
        {/if}
      </div>
    {:else if inspection !== null}
      {#if inspectedRepository !== null && !inspectedRepository.private}
        <p role="note" class="alert-warning">{PUBLIC_REPOSITORY_WARNING}</p>
      {/if}

      {#if inspection.kind === "notesRepo"}
        <UnlockForm
          bind:this={passphraseForm}
          bind:passphrase
          {username}
          busy={submitting}
          onsubmit={() => void handleUnlock()}
        >
          {@render passphraseFormFooter()}
        </UnlockForm>
      {:else}
        <CreateNotesRepoForm
          bind:this={passphraseForm}
          bind:passphrase
          bind:repeatedPassphrase
          mismatch={passphrasesDiffer}
          {username}
          description={describeSetUp(inspection.pending)}
          busy={submitting}
          onsubmit={() => void handleSetUp()}
        >
          {@render passphraseFormFooter()}
        </CreateNotesRepoForm>
      {/if}
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

  div.alert-error {
    display: grid;
    gap: var(--space-2);
  }

  div.alert-error p {
    margin: 0;
  }

  .repository-problem {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }

  .repository-problem p {
    margin: 0;
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
