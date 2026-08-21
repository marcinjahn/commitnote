<script lang="ts">
  import { onMount } from "svelte";
  import { checkReplacementToken } from "./app/replace-access-token";
  import { installRefreshTriggers } from "./app/refresh-triggers";
  import { installLifecycleTriggers } from "./app/lifecycle-triggers";
  import type {
    LoginError,
    LoginInput,
    LoginStep,
    PendingInitialization,
  } from "./login/login";
  import { initializeNotesRepo, logIn, resumeSession } from "./login/login";
  import type { ForgeAdapter } from "./forge/forge-adapter";
  import type { ForgeAdapterFactory } from "./forge/registry";
  import { createSessionStore } from "./session/session-store";
  import type { Session } from "./session/session";
  import { systemClock } from "./sync/clock";
  import { createRateBudget } from "./sync/rate-budget";
  import { createSyncEngine } from "./sync/sync-engine";
  import type { SyncEngine, SyncEngineState } from "./sync/sync-engine";
  import { describeLoginError, GENERIC_LOGIN_ERROR } from "./ui/login/login-messages";
  import LogoutDialog from "./ui/session/LogoutDialog.svelte";
  import TokenDialog from "./ui/session/TokenDialog.svelte";
  import LoginScreen from "./ui/login/LoginScreen.svelte";
  import AppShell from "./ui/browse/AppShell.svelte";

  interface Props {
    createAdapter: ForgeAdapterFactory;
    testModeBanner: string | null;
  }

  const { createAdapter, testModeBanner }: Props = $props();

  type Phase =
    | { readonly kind: "restoring" }
    | {
        readonly kind: "login";
        readonly initialRepoUrl: string;
        readonly initialError: LoginError | null;
      }
    | {
        readonly kind: "app";
        readonly engine: SyncEngine;
        readonly repoLabel: string;
      };

  const store = createSessionStore();
  const rateBudget = createRateBudget(systemClock);

  const budgetedCreateAdapter: ForgeAdapterFactory = (coordinates, options) =>
    createAdapter(coordinates, {
      ...options,
      onContentCreatingRequest: (request) => {
        rateBudget.record();
        options.onContentCreatingRequest?.(request);
      },
    });

  let phase = $state<Phase>({ kind: "restoring" });
  let loginKey = $state(0);
  let uninstallRefreshTriggers: (() => void) | null = null;
  let uninstallLifecycleTriggers: (() => void) | null = null;
  let currentSession: Session | null = null;
  let currentRememberMe = false;

  let engineState = $state<SyncEngineState | null>(null);
  let logout = $state<
    | null
    | { readonly kind: "saving" }
    | { readonly kind: "unsaved"; readonly count: number }
  >(null);
  let tokenChecking = $state(false);
  let tokenError = $state<string | null>(null);

  $effect(() => {
    if (phase.kind !== "app") {
      engineState = null;
      return;
    }
    return phase.engine.subscribe((next) => {
      engineState = next;
    });
  });

  const tokenDialogOpen = $derived(
    logout === null && engineState?.save.kind === "stopped",
  );

  function loginDeps() {
    return { createAdapter: budgetedCreateAdapter };
  }

  function showLogin(initialError: LoginError | null): void {
    loginKey++;
    phase = {
      kind: "login",
      initialRepoUrl: store.lastRepoUrl() ?? "",
      initialError,
    };
  }

  async function startApp(
    session: Session,
    adapter: ForgeAdapter,
    rememberMe: boolean,
  ): Promise<void> {
    await store.start(session, { rememberMe });
    currentSession = session;
    currentRememberMe = rememberMe;

    const engine = createSyncEngine({
      adapter,
      keyring: session.keyring,
      clock: systemClock,
      rateBudget,
    });
    uninstallRefreshTriggers = installRefreshTriggers({ window, document }, () => {
      void engine.refresh();
    });
    uninstallLifecycleTriggers = installLifecycleTriggers(
      { window, document },
      {
        flush: () => void engine.flush(),
        retryNow: () => engine.retryNow(),
        hasUnsaved: () => engine.getState().syncStates.hasUnsaved,
      },
    );

    phase = {
      kind: "app",
      engine,
      repoLabel: `${session.coordinates.owner}/${session.coordinates.repo}`,
    };
    void engine.refresh();
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
    uninstallRefreshTriggers?.();
    uninstallRefreshTriggers = null;
    uninstallLifecycleTriggers?.();
    uninstallLifecycleTriggers = null;
    phase.engine.dispose();
    currentSession = null;
    tokenChecking = false;
    tokenError = null;
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

  async function submitAccessToken(accessToken: string): Promise<void> {
    if (phase.kind !== "app" || currentSession === null || tokenChecking) return;
    const engine = phase.engine;
    const session = currentSession;
    tokenChecking = true;
    tokenError = null;
    try {
      const check = await checkReplacementToken(
        budgetedCreateAdapter,
        session.coordinates,
        accessToken,
      );
      if (check.kind === "failed") {
        tokenError = describeLoginError(check.error);
        return;
      }
      const renewed: Session = { ...session, accessToken: accessToken.trim() };
      await store.start(renewed, { rememberMe: currentRememberMe });
      currentSession = renewed;
      engine.replaceAdapter(check.adapter);
    } catch (e) {
      console.error(e);
      tokenError = GENERIC_LOGIN_ERROR;
    } finally {
      tokenChecking = false;
    }
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
  <p class="notice" role="note">{testModeBanner}</p>
{/if}

{#if phase.kind === "restoring"}
  <main>
    <h1>commitnote</h1>
    <p>Loading…</p>
  </main>
{:else if phase.kind === "login"}
  {#key loginKey}
    <LoginScreen
      initialRepoUrl={phase.initialRepoUrl}
      initialError={phase.initialError}
      logIn={boundLogIn}
      initialize={boundInitialize}
      onLoggedIn={handleLoggedIn}
    />
  {/key}
{:else if phase.kind === "app"}
  <AppShell engine={phase.engine} repoLabel={phase.repoLabel} onLogOut={logOut} />
  <TokenDialog
    open={tokenDialogOpen}
    checking={tokenChecking}
    error={tokenError}
    onSubmit={submitAccessToken}
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
