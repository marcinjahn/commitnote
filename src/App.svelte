<script lang="ts">
  import { onMount } from "svelte";
  import { installLifecycleTriggers } from "./app/lifecycle-triggers";
  import type {
    LoginError,
    LoginInput,
    LoginStep,
    PendingInitialization,
  } from "./login/login";
  import {
    initializeNotesRepo,
    logIn,
    repositoryLabel,
    resumeSession,
  } from "./login/login";
  import type { ForgeAdapter } from "./forge/forge-adapter";
  import type { ForgeId } from "./forge/repo-coordinates";
  import type { ForgeAdapterFactory, ForgeRegistry } from "./forge/registry";
  import { adapterFactoryFor, forgeProviders } from "./forge/registry";
  import { createSessionStore } from "./session/session-store";
  import type { Session } from "./session/session";
  import { systemClock } from "./sync/clock";
  import { createRateBudget, type RateBudget } from "./sync/rate-budget";
  import { createSyncEngine } from "./sync/sync-engine";
  import type { SyncEngine } from "./sync/sync-engine";
  import type { Keyring } from "./crypto/keyring";
  import {
    createPassphraseChange,
    type LandedCheck,
    type PassphraseChange,
  } from "./rekey/change-passphrase";
  import {
    PASSPHRASE_CHANGED_MESSAGE,
    PASSPHRASE_CHANGED_MISMATCH_MESSAGE,
  } from "./ui/passphrase/passphrase-messages";
  import KeyChangedScreen from "./ui/session/KeyChangedScreen.svelte";
  import LogoutDialog from "./ui/session/LogoutDialog.svelte";
  import LoginScreen from "./ui/login/LoginScreen.svelte";
  import AppShell from "./ui/browse/AppShell.svelte";
  import Wordmark from "./ui/wordmark/Wordmark.svelte";

  interface Props {
    registry: ForgeRegistry;
    testModeBanner: string | null;
  }

  const { registry, testModeBanner }: Props = $props();

  type Phase =
    | { readonly kind: "restoring" }
    | {
        readonly kind: "login";
        readonly initialRepoUrl: string;
        readonly initialForgeId: string | null;
        readonly initialError: LoginError | null;
      }
    | {
        readonly kind: "app";
        readonly engine: SyncEngine;
        readonly session: Session;
        readonly adapter: ForgeAdapter;
        readonly rememberMe: boolean;
        readonly passphraseChange: PassphraseChange;
        readonly initialMessage: string | null;
        readonly repoLabel: string;
        readonly repoUrl: string;
        readonly forgeName: string;
      };

  const store = createSessionStore();
  const rateBudgets = new Map<ForgeId, RateBudget>();

  function rateBudgetFor(forge: ForgeId, adapter: ForgeAdapter): RateBudget {
    let budget = rateBudgets.get(forge);
    if (budget === undefined) {
      budget = createRateBudget(systemClock, adapter.limits);
      rateBudgets.set(forge, budget);
    }
    return budget;
  }

  const providers = $derived(forgeProviders(registry));
  const budgetedCreateAdapter: ForgeAdapterFactory = (coordinates, options) => {
    const adapter = adapterFactoryFor(registry)(coordinates, {
      ...options,
      onContentCreatingRequest: (request) => {
        rateBudgetFor(coordinates.forge, adapter).record();
        options.onContentCreatingRequest?.(request);
      },
    });
    return adapter;
  };

  let phase = $state.raw<Phase>({ kind: "restoring" });
  let loginKey = $state(0);
  let uninstallLifecycleTriggers: (() => void) | null = null;
  let unsubscribeStopped: (() => void) | null = null;
  let keyChanged = $state<{ readonly unsavedCount: number } | null>(null);

  let logout = $state<
    | null
    | { readonly kind: "saving" }
    | { readonly kind: "unsaved"; readonly count: number }
  >(null);

  function loginDeps() {
    return { createAdapter: budgetedCreateAdapter };
  }

  function showLogin(initialError: LoginError | null): void {
    loginKey++;
    phase = {
      kind: "login",
      initialRepoUrl: store.lastRepoUrl() ?? "",
      initialForgeId: store.lastForgeId(),
      initialError,
    };
  }

  async function startApp(
    session: Session,
    adapter: ForgeAdapter,
    rememberMe: boolean,
    initialMessage: string | null = null,
  ): Promise<void> {
    phase = { kind: "restoring" };
    await store.start(session, { rememberMe });

    const rateBudget = rateBudgetFor(session.coordinates.forge, adapter);
    const engine = createSyncEngine({
      adapter,
      keyring: session.keyring,
      clock: systemClock,
      rateBudget,
    });
    unsubscribeStopped = engine.subscribe((state) => {
      keyChanged =
        state.stopped?.kind === "keyChanged"
          ? { unsavedCount: state.syncStates.unsavedCount }
          : null;
    });
    uninstallLifecycleTriggers = installLifecycleTriggers(
      { window, document },
      {
        flush: () => void engine.flush(),
        retryNow: () => engine.retryNow(),
        hasUnsaved: () => engine.getState().syncStates.hasUnsaved,
      },
    );

    // Forge errors resolve with `refresh.lastError` set, which the shell shows.
    let refreshed = true;
    try {
      await engine.refresh();
    } catch (e) {
      console.error(e);
      refreshed = false;
    }

    phase = {
      kind: "app",
      engine,
      session,
      adapter,
      rememberMe,
      passphraseChange: createPassphraseChange({
        adapter,
        engine,
        rateBudget,
        clock: systemClock,
      }),
      initialMessage,
      repoLabel: repositoryLabel(session.coordinates),
      repoUrl: session.repoUrl,
      forgeName: registry[session.coordinates.forge].name,
    };
    if (refreshed) {
      try {
        engine.purgeExpiredTrash();
      } catch {
        console.error("Trash purge failed");
      }
      adapter.sweepAbandoned?.().catch(() => {
        console.error("Sweeping abandoned atomic commits failed");
      });
    }
  }

  async function handleLoggedIn(result: {
    session: Session;
    adapter: ForgeAdapter;
    rememberMe: boolean;
  }): Promise<void> {
    await startApp(result.session, result.adapter, result.rememberMe);
  }

  function stopApp(engine: SyncEngine): void {
    uninstallLifecycleTriggers?.();
    uninstallLifecycleTriggers = null;
    unsubscribeStopped?.();
    unsubscribeStopped = null;
    keyChanged = null;
    engine.dispose();
  }

  async function handlePassphraseChanged(
    keyring: Keyring,
    check: LandedCheck,
  ): Promise<void> {
    if (phase.kind !== "app") return;
    const { engine, session, adapter, rememberMe } = phase;
    stopApp(engine);
    await startApp(
      { ...session, keyring },
      adapter,
      rememberMe,
      check === "mismatch"
        ? PASSPHRASE_CHANGED_MISMATCH_MESSAGE
        : PASSPHRASE_CHANGED_MESSAGE,
    );
  }

  async function finishLogOut(clearStore = true): Promise<void> {
    if (phase.kind !== "app") return;
    stopApp(phase.engine);
    if (clearStore) await store.clear();
    logout = null;
    showLogin(null);
  }

  // Another tab of this browser profile may have changed the passphrase and
  // remembered the new keys; those are used instead of asking to log in.
  async function logInAfterKeyChange(): Promise<void> {
    if (phase.kind !== "app") return;
    const { engine, session } = phase;
    let remembered: Session | null = null;
    try {
      remembered = await store.loadRememberedSession();
    } catch {
      remembered = null;
    }
    if (
      remembered === null ||
      remembered.coordinates.forge !== session.coordinates.forge ||
      remembered.coordinates.owner !== session.coordinates.owner ||
      remembered.coordinates.repo !== session.coordinates.repo
    ) {
      await finishLogOut();
      return;
    }
    const result = await resumeSession(remembered, loginDeps());
    if (result.kind === "loggedIn") {
      stopApp(engine);
      await startApp(result.session, result.adapter, true);
      return;
    }
    const transient =
      result.error.kind === "network" ||
      result.error.kind === "server" ||
      result.error.kind === "rateLimited";
    await finishLogOut(!transient);
  }

  async function attemptLogOut(): Promise<void> {
    if (phase.kind !== "app") return;
    logout = { kind: "saving" };
    const result = await phase.engine.flush();
    if (result.kind === "saved") {
      await finishLogOut();
    } else {
      logout = { kind: "unsaved", count: result.count };
    }
  }

  async function logOut(): Promise<void> {
    if (phase.kind !== "app" || logout !== null) return;
    await attemptLogOut();
  }

  function boundLogIn(
    input: LoginInput,
    onStep: (step: LoginStep) => void,
  ) {
    return logIn(input, loginDeps(), onStep);
  }

  function boundInitialize(
    pending: PendingInitialization,
    passphrase: string,
    onStep: (step: LoginStep) => void,
  ) {
    return initializeNotesRepo(pending, passphrase, loginDeps(), onStep);
  }

  onMount(() => {
    void (async () => {
      try {
        const session = await store.loadRememberedSession();
        if (session === null) {
          showLogin(null);
          return;
        }

        const result = await resumeSession(session, loginDeps());
        switch (result.kind) {
          case "loggedIn":
            await startApp(result.session, result.adapter, true);
            return;
          case "failed": {
            const keepStoredRecord =
              result.error.kind === "network" ||
              result.error.kind === "server" ||
              result.error.kind === "rateLimited";
            if (!keepStoredRecord) {
              await store.clear();
            }
            showLogin(result.error);
          }
        }
      } catch (e) {
        console.error(e);
        showLogin(null);
      }
    })();
  });
</script>

{#if testModeBanner !== null}
  <p class="notice test-mode-banner" role="note">{testModeBanner}</p>
{/if}

{#if phase.kind === "restoring"}
  <main class="restoring">
    <Wordmark element="h1" />
    <p class="restoring-text">Loading…</p>
  </main>
{:else if phase.kind === "login"}
  {#key loginKey}
    <LoginScreen
      {providers}
      initialRepoUrl={phase.initialRepoUrl}
      initialForgeId={phase.initialForgeId}
      initialError={phase.initialError}
      logIn={boundLogIn}
      initialize={boundInitialize}
      onLoggedIn={handleLoggedIn}
    />
  {/key}
{:else if phase.kind === "app" && keyChanged !== null}
  <KeyChangedScreen
    engine={phase.engine}
    unsavedCount={keyChanged.unsavedCount}
    onLogInAgain={() => void logInAfterKeyChange()}
  />
{:else if phase.kind === "app"}
  <AppShell
    engine={phase.engine}
    repoLabel={phase.repoLabel}
    repoUrl={phase.repoUrl}
    forgeName={phase.forgeName}
    passphraseChange={phase.passphraseChange}
    initialMessage={phase.initialMessage}
    onPassphraseChanged={(keyring, check) =>
      void handlePassphraseChanged(keyring, check)}
    onLogOut={logOut}
  />
  <LogoutDialog
    open={logout !== null}
    saving={logout?.kind !== "unsaved"}
    unsavedCount={logout?.kind === "unsaved" ? logout.count : 0}
    onKeepTrying={attemptLogOut}
    onLogOutAnyway={finishLogOut}
  />
{/if}

<style>
  .test-mode-banner {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-xs);
    letter-spacing: 0.02em;
    padding: var(--space-1) var(--space-3);
  }

  .restoring {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .restoring-text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
