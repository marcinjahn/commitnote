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
  import type { ForgeAdapterFactory, ForgeRegistry } from "./forge/registry";
  import { adapterFactoryFor, forgeProviders } from "./forge/registry";
  import { createSessionStore } from "./session/session-store";
  import type { Session } from "./session/session";
  import { systemClock } from "./sync/clock";
  import { createRateBudget } from "./sync/rate-budget";
  import { createSyncEngine } from "./sync/sync-engine";
  import type { SyncEngine } from "./sync/sync-engine";
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
        readonly repoLabel: string;
        readonly repoUrl: string;
        readonly forgeName: string;
      };

  const store = createSessionStore();
  const rateBudget = createRateBudget(systemClock);

  const providers = $derived(forgeProviders(registry));
  const budgetedCreateAdapter: ForgeAdapterFactory = (coordinates, options) =>
    adapterFactoryFor(registry)(coordinates, {
      ...options,
      onContentCreatingRequest: (request) => {
        rateBudget.record();
        options.onContentCreatingRequest?.(request);
      },
    });

  let phase = $state<Phase>({ kind: "restoring" });
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
  ): Promise<void> {
    phase = { kind: "restoring" };
    await store.start(session, { rememberMe });

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
    }
  }

  async function handleLoggedIn(result: {
    session: Session;
    adapter: ForgeAdapter;
    rememberMe: boolean;
  }): Promise<void> {
    await startApp(result.session, result.adapter, result.rememberMe);
  }

  async function finishLogOut(): Promise<void> {
    if (phase.kind !== "app") return;
    uninstallLifecycleTriggers?.();
    uninstallLifecycleTriggers = null;
    unsubscribeStopped?.();
    unsubscribeStopped = null;
    keyChanged = null;
    phase.engine.dispose();
    await store.clear();
    logout = null;
    showLogin(null);
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
    onLogInAgain={finishLogOut}
  />
{:else if phase.kind === "app"}
  <AppShell
    engine={phase.engine}
    repoLabel={phase.repoLabel}
    repoUrl={phase.repoUrl}
    forgeName={phase.forgeName}
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
