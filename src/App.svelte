<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { removeLastView } from "./app/last-view";
  import { createAutoRefresh, type AutoRefresh } from "./app/auto-refresh";
  import { installLifecycleTriggers } from "./app/lifecycle-triggers";
  import { isStandalone } from "./app/display-mode";
  import { requestPersistentStorage } from "./app/persistent-storage";
  import type { AppUpdates } from "./app/app-updates";
  import { createUpdateGate, type UpdateGate } from "./app/update-gate";
  import { clearNoteFragment } from "./app/note-navigation";
  import {
    openSessionBlobCache,
    purgeBlobCacheNow,
    purgeBlobCacheWhenIndexed,
  } from "./app/blob-cache-lifecycle";
  import type { BlobCache } from "./blob-cache/blob-cache";
  import { deleteBlobCacheDatabase } from "./blob-cache/blob-store";
  import { repoKeyOf } from "./blob-cache/blob-cache";
  import { withBlobCache } from "./blob-cache/caching-adapter";
  import type {
    LoginError,
    LoginStep,
    NotesRepoTarget,
    PendingInitialization,
  } from "./login/login";
  import {
    initializeNotesRepo,
    inspectRepository,
    isTransient,
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
  import { createShareService, type ShareService } from "./share/share-service";
  import { shareLinkBase } from "./share/share-link";
  import { argon2idInWorker } from "./crypto/argon2";
  import { createSyncEngine } from "./sync/sync-engine";
  import { createContentIndexer, type ContentIndexer } from "./search/content-indexer";
  import { createBrowserIndexerEnvironment } from "./search/indexer-environment";
  import { SETTINGS_SAVE_DEBOUNCE_MS, SETTINGS_SAVE_MAX_WAIT_MS } from "./sync/tuning";
  import { createSettingsSaver, type SettingsSaver } from "./settings/settings-saver";
  import type { SyncEngine } from "./sync/sync-engine";
  import type { Keyring } from "./crypto/keyring";
  import type { Argon2idFunction } from "./crypto/argon2";
  import {
    createPassphraseChange,
    type HistoryOutcome,
    type LandedCheck,
    type PassphraseChange,
  } from "./rekey/change-passphrase";
  import { createNoteHistory, type NoteHistory } from "./history/note-history";
  import { createNoteDates, type NoteDatesResolver } from "./history/note-dates";
  import type { ToastMessage } from "./ui/notices/notice-messages";
  import { describePassphraseChanged } from "./ui/passphrase/passphrase-messages";
  import {
    accentCustomProperties,
    type AccentColorId,
    type AccentCustomProperties,
  } from "./settings/accent-palette";
  import {
    refreshSystemAccent,
    systemAccent,
    watchSystemAccent,
  } from "./ui/system-accent.svelte";
  import { readCachedColorMode } from "./session/color-mode-cache";
  import type { ColorModeId } from "./settings/color-mode";
  import {
    createColorModeApplier,
    type ColorModeApplier,
  } from "./ui/color-mode-applier";
  import { noteFontFamily, type NoteFont } from "./settings/note-font";
  import KeyChangedScreen from "./ui/session/KeyChangedScreen.svelte";
  import LogoutDialog from "./ui/session/LogoutDialog.svelte";
  import LoginScreen from "./ui/login/LoginScreen.svelte";
  import AppShell from "./ui/browse/AppShell.svelte";
  import PrintView from "./ui/print/PrintView.svelte";
  import type { PrintNote } from "./ui/print/print-note";
  import Wordmark from "./ui/wordmark/Wordmark.svelte";
  import type { InstallController } from "./app/install-controller";
  import InstallBar from "./ui/install/InstallBar.svelte";
  import InstallHowToDialog from "./ui/install/InstallHowToDialog.svelte";
  import { createDialogEntries } from "./ui/dialogs/dialog-entries";
  import { bindDialogHistory, type DialogHistory } from "./ui/dialogs/dialog-history";
  import { dialogStack } from "./ui/dialogs/dialog-stack";

  interface Props {
    registry: ForgeRegistry;
    testModeBanner: string | null;
    argon2id?: Argon2idFunction;
    appUpdates: AppUpdates | null;
    install: InstallController;
  }

  const { registry, testModeBanner, argon2id, appUpdates, install }: Props =
    $props();

  let installState = $state(untrack(() => install.getState()));
  onMount(() => install.subscribe((state) => (installState = state)));

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
        readonly autoRefresh: AutoRefresh;
        readonly settingsSaver: SettingsSaver;
        readonly updateGate: UpdateGate;
        readonly contentIndexer: ContentIndexer;
        readonly session: Session;
        readonly adapter: ForgeAdapter;
        readonly blobCache: BlobCache | null;
        readonly rememberMe: boolean;
        readonly remembered: boolean;
        readonly passphraseChange: PassphraseChange;
        readonly noteHistory: NoteHistory;
        readonly shareService: ShareService;
        readonly noteDatesResolver: NoteDatesResolver;
        readonly initialMessage: Pick<ToastMessage, "tone" | "text"> | null;
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
  let autoRefresh: AutoRefresh | null = null;
  let uninstallLifecycleTriggers: (() => void) | null = null;
  let updateGate: UpdateGate | null = null;
  let detachUpdateGate: (() => void) | null = null;
  let uninstallBlobCachePurge: (() => void) | null = null;
  let unsubscribeStopped: (() => void) | null = null;
  let keyChanged = $state<{ readonly unsavedCount: number } | null>(null);

  let reportedAccentColor = $state<AccentColorId>("system");
  const appliedAccentColor = $derived<AccentColorId>(
    keyChanged !== null ? "system" : reportedAccentColor,
  );

  $effect(() => untrack(() => watchSystemAccent(window)));

  let reportedColorMode = $state<ColorModeId>(readCachedColorMode() ?? "system");
  let colorModeApplier: ColorModeApplier | null = null;

  $effect(() =>
    untrack(() => {
      colorModeApplier = createColorModeApplier(window, {
        onSchemeChange: refreshSystemAccent,
      });
      return () => {
        colorModeApplier?.dispose();
        colorModeApplier = null;
      };
    }),
  );

  $effect(() => {
    colorModeApplier?.applyColorMode(reportedColorMode, { animate: true });
  });

  function applyAccent(properties: AccentCustomProperties): void {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(properties)) {
      if (value === null) style.removeProperty(name);
      else style.setProperty(name, value);
    }
  }

  let accentApplied = false;

  $effect(() => {
    const id =
      appliedAccentColor === "system" ? systemAccent().id : appliedAccentColor;
    const properties = accentCustomProperties(id);
    if (!accentApplied) {
      accentApplied = true;
      applyAccent(properties);
      return;
    }
    // The change often lands in the task that mounts a whole screen, and a
    // transition started there is timed from the previous frame, so a slow mount
    // eats most of it. Starting it after the new screen's first frame avoids that.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => applyAccent(properties));
    });
    return () => cancelAnimationFrame(frame);
  });

  let reportedNoteFont = $state<NoteFont>("inter");
  let reportedPrintNote = $state.raw<PrintNote | null>(null);
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
    return { createAdapter: budgetedCreateAdapter, argon2id };
  }

  function resetReported(): void {
    reportedAccentColor = "system";
    reportedNoteFont = "inter";
    reportedPrintNote = null;
  }

  function showLogin(initialError: LoginError | null): void {
    loginKey++;
    resetReported();
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
    initialMessage: Pick<ToastMessage, "tone" | "text"> | null = null,
    purgeBlobCache = false,
    resumed = false,
  ): Promise<void> {
    phase = { kind: "restoring" };
    const { remembered } = await store.start(session, { rememberMe });
    if (
      remembered &&
      (!resumed ||
        isStandalone({
          matchMedia: (q) => window.matchMedia(q),
          navigator: navigator as { standalone?: boolean },
        }))
    ) {
      void requestPersistentStorage(navigator.storage);
    }
    const blobCache = await openSessionBlobCache({
      remembered,
      coordinates: session.coordinates,
      clock: systemClock,
    });
    const cachedAdapter =
      blobCache === null ? adapter : withBlobCache(adapter, blobCache);

    const rateBudget = rateBudgetFor(session.coordinates.forge, cachedAdapter);
    const noteHistory = createNoteHistory({
      adapter: cachedAdapter,
      keyring: session.keyring,
    });
    const engine = createSyncEngine({
      adapter: cachedAdapter,
      keyring: session.keyring,
      clock: systemClock,
      rateBudget,
      isOnline: () => navigator.onLine,
      ...(blobCache === null ? {} : { blobCache }),
    });
    const contentIndexer = createContentIndexer({
      engine,
      clock: systemClock,
      environment: createBrowserIndexerEnvironment(),
    });
    if (blobCache !== null) {
      uninstallBlobCachePurge = purgeBlobCacheWhenIndexed({
        indexer: contentIndexer,
        engine,
        cache: blobCache,
        clock: systemClock,
      });
    }
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
        resetReported();
      } else {
        keyChanged = null;
      }
    });
    const hasUnsaved = () =>
      settingsSaver.hasPending || engine.getState().syncStates.hasUnsaved;
    const flush = () => {
      settingsSaver.flush();
      void engine.flush();
    };
    uninstallLifecycleTriggers = installLifecycleTriggers(
      { window, document },
      {
        flush,
        retryNow: () => engine.retryNow(),
        setOnline: (online) => engine.setOnline(online),
        setVisible: (visible) => autoRefresh?.setVisible(visible),
        refreshTrigger: (trigger) => {
          autoRefresh?.trigger(trigger);
          appUpdates?.checkForUpdate();
        },
        hasUnsaved,
      },
    );
    const gate = createUpdateGate({
      hasUnsaved,
      flush,
      onUnsavedChange: (listener) => {
        const stopEngine = engine.subscribe(() => listener());
        const stopSaver = settingsSaver.subscribe(listener);
        return () => {
          stopEngine();
          stopSaver();
        };
      },
      skipWaiting: () => appUpdates?.skipWaiting(),
      reload: () => location.reload(),
    });
    updateGate = gate;
    detachUpdateGate = appUpdates?.attachGate(gate) ?? null;

    // Forge errors resolve with `refresh.lastError` set, which the shell shows.
    let refreshed = true;
    try {
      await engine.refresh();
    } catch (e) {
      console.error(e);
      refreshed = false;
    }

    const refreshScheduler = createAutoRefresh({
      refresh: () => engine.refresh(),
      lastError: () => engine.getState().refresh.lastError,
      canRefresh: () => {
        const s = engine.getState();
        return (
          document.visibilityState === "visible" &&
          s.online &&
          s.stopped === null &&
          !s.suspended &&
          !s.importing &&
          !s.refresh.inFlight &&
          !engine.hasLocalWork()
        );
      },
      observedRateLimit: () => cachedAdapter.observedRateLimit?.() ?? null,
      clock: systemClock,
      visible: document.visibilityState === "visible",
    });
    autoRefresh = refreshScheduler;

    phase = {
      kind: "app",
      engine,
      autoRefresh: refreshScheduler,
      settingsSaver,
      updateGate: gate,
      contentIndexer,
      session,
      adapter,
      blobCache,
      rememberMe,
      remembered,
      passphraseChange: createPassphraseChange({
        adapter: cachedAdapter,
        engine,
        rateBudget,
        clock: systemClock,
        argon2id,
      }),
      noteHistory,
      shareService: createShareService({
        engine,
        shareHost: adapter.shareHost,
        noteHistory,
        rateBudget,
        clock: systemClock,
        argon2id: argon2id ?? argon2idInWorker,
        linkBase: shareLinkBase(location),
      }),
      noteDatesResolver: createNoteDates({
        adapter: cachedAdapter,
        keyring: session.keyring,
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
      cachedAdapter.sweepAbandoned?.().catch(() => {
        console.error("Sweeping abandoned atomic commits failed");
      });
      if (purgeBlobCache && blobCache !== null) {
        purgeBlobCacheNow({ engine, cache: blobCache, clock: systemClock });
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

  function stopApp(
    engine: SyncEngine,
    settingsSaver: SettingsSaver,
    contentIndexer: ContentIndexer,
    blobCache: BlobCache | null,
    clearBlobCache: boolean,
  ): Promise<void> {
    uninstallLifecycleTriggers?.();
    uninstallLifecycleTriggers = null;
    detachUpdateGate?.();
    detachUpdateGate = null;
    updateGate?.dispose();
    updateGate = null;
    autoRefresh?.dispose();
    autoRefresh = null;
    uninstallBlobCachePurge?.();
    uninstallBlobCachePurge = null;
    unsubscribeStopped?.();
    unsubscribeStopped = null;
    keyChanged = null;
    settingsSaver.dispose();
    contentIndexer.dispose();
    engine.dispose();
    if (blobCache === null) return Promise.resolve();
    return clearBlobCache ? blobCache.clear() : blobCache.dispose();
  }

  async function handlePassphraseChanged(
    keyring: Keyring,
    check: LandedCheck,
    history: HistoryOutcome,
  ): Promise<void> {
    if (phase.kind !== "app") return;
    const {
      engine,
      settingsSaver,
      contentIndexer,
      blobCache,
      session,
      adapter,
      rememberMe,
    } = phase;
    await stopApp(engine, settingsSaver, contentIndexer, blobCache, false);
    await startApp(
      { ...session, keyring },
      adapter,
      rememberMe,
      describePassphraseChanged(check, history),
      true,
    );
  }

  async function finishLogOut(clearStore = true): Promise<void> {
    if (phase.kind !== "app") return;
    const { engine, settingsSaver, contentIndexer, blobCache, session } = phase;
    await stopApp(engine, settingsSaver, contentIndexer, blobCache, true);
    if (clearStore) await store.clear();
    removeLastView(repoKeyOf(session.coordinates));
    logout = null;
    clearNoteFragment(window.history, window.location);
    showLogin(null);
  }

  // Another tab of this browser profile may have changed the passphrase and
  // remembered the new keys; those are used instead of asking to log in.
  async function logInAfterKeyChange(): Promise<void> {
    if (phase.kind !== "app") return;
    const { engine, settingsSaver, contentIndexer, blobCache, session } = phase;
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
      await stopApp(engine, settingsSaver, contentIndexer, blobCache, true);
      await startApp(result.session, result.adapter, true);
      return;
    }
    await finishLogOut(!isTransient(result.error));
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

  const onLoginScreen = $derived(phase.kind === "login");

  $effect(() => {
    if (!onLoginScreen) return;
    let binding: DialogHistory | null = null;
    const entries = createDialogEntries({
      history: window.history,
      events: window,
      onBack: (count) => void binding?.closeFromBack(count),
    });
    binding = bindDialogHistory({
      stack: dialogStack,
      navigation: entries,
      requestClose: (el) =>
        el.dispatchEvent(new Event("cancel", { cancelable: true })),
      settle: tick,
    });
    return () => {
      binding?.dispose();
      entries.dispose();
    };
  });

  onMount(() => {
    void (async () => {
      try {
        const session = await store.loadRememberedSession();
        if (session === null) {
          await deleteBlobCacheDatabase();
          showLogin(null);
          return;
        }

        const result = await resumeSession(session, loginDeps());
        switch (result.kind) {
          case "loggedIn":
            await startApp(
              result.session,
              result.adapter,
              true,
              null,
              false,
              true,
            );
            return;
          case "failed": {
            if (!isTransient(result.error)) {
              await store.clear();
              removeLastView(repoKeyOf(session.coordinates));
              await deleteBlobCacheDatabase();
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
  {#if installState.bar !== "none"}
    <InstallBar
      variant={installState.bar}
      sideInsets
      onInstall={() => void install.install()}
      onDismiss={() => install.dismiss()}
    />
  {/if}
  {#key loginKey}
    <LoginScreen
      belowInstallBar={installState.bar !== "none"}
      {providers}
      initialRepoUrl={phase.initialRepoUrl}
      initialForgeId={phase.initialForgeId}
      initialError={phase.initialError}
      inspect={boundInspect}
      unlock={boundUnlock}
      initialize={boundInitialize}
      onLoggedIn={handleLoggedIn}
      onAccentColor={(id) => (reportedAccentColor = id)}
      onColorMode={(id) => (reportedColorMode = id)}
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
    autoRefresh={phase.autoRefresh}
    settingsSaver={phase.settingsSaver}
    updateGate={phase.updateGate}
    {appUpdates}
    {install}
    contentIndexer={phase.contentIndexer}
    repoLabel={phase.repoLabel}
    repoUrl={phase.repoUrl}
    forgeName={phase.forgeName}
    passphraseChange={phase.passphraseChange}
    noteHistory={phase.noteHistory}
    shareService={phase.shareService}
    forgeId={phase.session.coordinates.forge}
    noteDatesResolver={phase.noteDatesResolver}
    keyring={phase.session.keyring}
    repoKey={repoKeyOf(phase.session.coordinates)}
    sessionRemembered={phase.remembered}
    initialMessage={phase.initialMessage}
    onPassphraseChanged={(keyring, check, history) =>
      void handlePassphraseChanged(keyring, check, history)}
    onLogOut={logOut}
    onAccentColor={(id) => (reportedAccentColor = id)}
      onColorMode={(id) => (reportedColorMode = id)}
    onNoteFont={(id) => (reportedNoteFont = id)}
    onPrintNote={(note) => (reportedPrintNote = note)}
  />
  <LogoutDialog
    open={logout !== null}
    saving={logout?.kind !== "unsaved"}
    unsavedCount={logout?.kind === "unsaved" ? logout.count : 0}
    onKeepTrying={attemptLogOut}
    onLogOutAnyway={finishLogOut}
  />
{/if}

<InstallHowToDialog
  open={installState.howToOpen}
  onClose={() => install.closeHowTo()}
/>

<PrintView note={phase.kind === "app" && keyChanged === null ? reportedPrintNote : null} />

<style>
  .test-mode-banner {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-xs);
    letter-spacing: 0.02em;
    padding: var(--space-1) var(--space-3);
  }

  .restoring {
    flex: 1 0 auto;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-2);
    padding: calc(var(--space-4) + env(safe-area-inset-top))
      calc(var(--space-4) + env(safe-area-inset-right)) var(--space-4)
      calc(var(--space-4) + env(safe-area-inset-left));
  }

  .restoring-text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
</style>
