<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { installLifecycleTriggers } from "./app/lifecycle-triggers";
  import type {
    LoginError,
    LoginStep,
    NotesRepoTarget,
    PendingInitialization,
  } from "./login/login";
  import {
    initializeNotesRepo,
    inspectRepository,
    repositoryLabel,
    resumeSession,
    unlockNotesRepo,
  } from "./login/login";
  import type { RepositorySummary } from "./forge/forge-provider";
  import type { ForgeAdapter } from "./forge/forge-adapter";
  import type { ForgeId } from "./forge/repo-coordinates";
  import type { ForgeAdapterFactory, ForgeRegistry } from "./forge/registry";
  import { adapterFactoryFor, forgeProviders } from "./forge/registry";
  import { createSessionStore } from "./session/session-store";
  import type { Session } from "./session/session";
  import { systemClock } from "./sync/clock";
  import { createRateBudget, type RateBudget } from "./sync/rate-budget";
  import { createSyncEngine } from "./sync/sync-engine";
  import { SETTINGS_SAVE_DEBOUNCE_MS, SETTINGS_SAVE_MAX_WAIT_MS } from "./sync/tuning";
  import { createSettingsSaver, type SettingsSaver } from "./settings/settings-saver";
  import type { SyncEngine } from "./sync/sync-engine";
  import type { Keyring } from "./crypto/keyring";
  import {
    createPassphraseChange,
    type HistoryOutcome,
    type LandedCheck,
    type PassphraseChange,
  } from "./rekey/change-passphrase";
  import { createNoteHistory, type NoteHistory } from "./history/note-history";
  import { describePassphraseChanged } from "./ui/passphrase/passphrase-messages";
  import { accentCustomProperties, type AccentColorId } from "./settings/accent-palette";
  import { systemAccent, watchSystemAccent } from "./ui/system-accent.svelte";
  import { noteFontFamily, type NoteFont } from "./settings/note-font";
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
        readonly settingsSaver: SettingsSaver;
        readonly session: Session;
        readonly adapter: ForgeAdapter;
        readonly rememberMe: boolean;
        readonly passphraseChange: PassphraseChange;
        readonly noteHistory: NoteHistory;
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

  let reportedAccentColor = $state<AccentColorId>("system");
  const appliedAccentColor = $derived<AccentColorId>(
    keyChanged !== null ? "system" : reportedAccentColor,
  );

  $effect(() => untrack(() => watchSystemAccent(window)));

  $effect(() => {
    const style = document.documentElement.style;
    const id =
      appliedAccentColor === "system" ? systemAccent().id : appliedAccentColor;
    for (const [name, value] of Object.entries(accentCustomProperties(id))) {
      if (value === null) style.removeProperty(name);
      else style.setProperty(name, value);
    }
  });

  let reportedNoteFont = $state<NoteFont>("inter");
  const appliedNoteFont = $derived<NoteFont>(
    keyChanged !== null ? "inter" : reportedNoteFont,
  );

  $effect(() => {
    const style = document.documentElement.style;
    if (appliedNoteFont === "inter") style.removeProperty("--font-note");
    else style.setProperty("--font-note", noteFontFamily(appliedNoteFont));
  });

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
    reportedAccentColor = "system";
    reportedNoteFont = "inter";
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
    const settingsSaver = createSettingsSaver({
      clock: systemClock,
      debounceMs: SETTINGS_SAVE_DEBOUNCE_MS,
      maxWaitMs: SETTINGS_SAVE_MAX_WAIT_MS,
      stored: () => engine.getState().rawSettings,
      save: (edits) => engine.changeSettings(edits),
    });
    unsubscribeStopped = engine.subscribe((state) => {
      if (state.stopped?.kind === "keyChanged") {
        keyChanged = { unsavedCount: state.syncStates.unsavedCount };
        reportedAccentColor = "system";
        reportedNoteFont = "inter";
      } else {
        keyChanged = null;
      }
    });
    uninstallLifecycleTriggers = installLifecycleTriggers(
      { window, document },
      {
        flush: () => {
          settingsSaver.flush();
          void engine.flush();
        },
        retryNow: () => engine.retryNow(),
        hasUnsaved: () =>
          settingsSaver.hasPending || engine.getState().syncStates.hasUnsaved,
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
      settingsSaver,
      session,
      adapter,
      rememberMe,
      passphraseChange: createPassphraseChange({
        adapter,
        engine,
        rateBudget,
        clock: systemClock,
      }),
      noteHistory: createNoteHistory({ adapter, keyring: session.keyring }),
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

  function stopApp(engine: SyncEngine, settingsSaver: SettingsSaver): void {
    uninstallLifecycleTriggers?.();
    uninstallLifecycleTriggers = null;
    unsubscribeStopped?.();
    unsubscribeStopped = null;
    keyChanged = null;
    settingsSaver.dispose();
    engine.dispose();
  }

  async function handlePassphraseChanged(
    keyring: Keyring,
    check: LandedCheck,
    history: HistoryOutcome,
  ): Promise<void> {
    if (phase.kind !== "app") return;
    const { engine, settingsSaver, session, adapter, rememberMe } = phase;
    stopApp(engine, settingsSaver);
    await startApp(
      { ...session, keyring },
      adapter,
      rememberMe,
      describePassphraseChanged(check, history),
    );
  }

  async function finishLogOut(clearStore = true): Promise<void> {
    if (phase.kind !== "app") return;
    stopApp(phase.engine, phase.settingsSaver);
    if (clearStore) await store.clear();
    logout = null;
    showLogin(null);
  }

  // Another tab of this browser profile may have changed the passphrase and
  // remembered the new keys; those are used instead of asking to log in.
  async function logInAfterKeyChange(): Promise<void> {
    if (phase.kind !== "app") return;
    const { engine, settingsSaver, session } = phase;
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
      stopApp(engine, settingsSaver);
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
    phase.settingsSaver.flush();
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

  function boundInspect(repository: RepositorySummary, accessToken: string) {
    return inspectRepository(repository, accessToken, loginDeps());
  }

  function boundUnlock(
    target: NotesRepoTarget,
    passphrase: string,
    onStep: (step: LoginStep) => void,
  ) {
    return unlockNotesRepo(target, passphrase, loginDeps(), onStep);
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
      inspect={boundInspect}
      unlock={boundUnlock}
      initialize={boundInitialize}
      onLoggedIn={handleLoggedIn}
      onAccentColor={(id) => (reportedAccentColor = id)}
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
    settingsSaver={phase.settingsSaver}
    repoLabel={phase.repoLabel}
    repoUrl={phase.repoUrl}
    forgeName={phase.forgeName}
    passphraseChange={phase.passphraseChange}
    noteHistory={phase.noteHistory}
    initialMessage={phase.initialMessage}
    onPassphraseChanged={(keyring, check, history) =>
      void handlePassphraseChanged(keyring, check, history)}
    onLogOut={logOut}
    onAccentColor={(id) => (reportedAccentColor = id)}
    onNoteFont={(id) => (reportedNoteFont = id)}
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
