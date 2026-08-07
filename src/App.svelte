<script lang="ts">
  import { onMount } from "svelte";
  import { installRefreshTriggers } from "./app/refresh-triggers";
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
  import { createSyncEngine } from "./sync/sync-engine";
  import type { SyncEngine } from "./sync/sync-engine";
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

  let phase = $state<Phase>({ kind: "restoring" });
  let loginKey = $state(0);
  let uninstallRefreshTriggers: (() => void) | null = null;

  function loginDeps() {
    return { createAdapter };
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

    const engine = createSyncEngine({
      adapter,
      keyring: session.keyring,
      clock: systemClock,
    });
    uninstallRefreshTriggers = installRefreshTriggers({ window, document }, () => {
      void engine.refresh();
    });

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

  async function logOut(): Promise<void> {
    if (phase.kind !== "app") return;
    uninstallRefreshTriggers?.();
    uninstallRefreshTriggers = null;
    phase.engine.dispose();
    await store.clear();
    showLogin(null);
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
    <h1>git-notes</h1>
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
{/if}
