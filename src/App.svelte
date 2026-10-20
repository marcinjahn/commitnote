<script lang="ts">
  import { flushSync, onMount, tick, untrack } from "svelte";
import { flushBeforeLogOut } from "./app/log-out";
  import { removeLastView } from "./app/last-view";
  import type { AutoRefresh } from "./app/auto-refresh";
  import { installLifecycleTriggers } from "./app/lifecycle-triggers";
  import { createBrowserPlatformPorts } from "./app/platform-ports";
  import type { AppUpdates } from "./app/app-updates";
  import {
    createReloadGuard,
    installAutoUpdate,
    isEditableElement,
    type AutoUpdate,
    type UpdateView,
  } from "./app/auto-update";
  import { browserSessionStorage } from "./app/update-resume";
  import {
    startApp as startRunningApp,
    stopApp as stopRunningApp,
    type AppServicesContext,
    type RunningApp,
    type StartAppDeps,
  } from "./app/start-app";
  import { resumeRemembered as resumeRememberedSession } from "./app/resume-remembered";
  import { deleteBlobCacheDatabase } from "./blob-cache/blob-store";
  import { repoKeyOf } from "./blob-cache/blob-cache";
  import {
    createEarlyDraftStore,
    deleteEarlyDraftDatabase,
  } from "./session/early-draft-store";
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
  import { argon2idInWorker } from "./crypto/argon2";
  import type { ContentIndexer } from "./search/content-indexer";
  import type { SettingsSaver } from "./settings/settings-saver";
  import { createDeviceSettingsStore } from "./settings/device-settings-store";
  import type { SyncEngine } from "./sync/sync-engine";
  import type { Keyring } from "./crypto/keyring";
  import type { Argon2idFunction } from "./crypto/argon2";
  import {
    createPassphraseChange,
    type HistoryOutcome,
    type LandedCheck,
    type PassphraseChange,
  } from "./rekey/change-passphrase";
  import { createImageResolver, type ImageResolver } from "./images/image-resolver";
  import type { ImageId } from "./images/image-id";
  import type { PendingImage } from "./images/pending-image";
  import { referencedImageIds } from "./images/image-reference";
  import { prepareImages } from "./images/prepare-images";
  import { loadImagePipeline } from "./images/load-image-pipeline";
  import { SHARE_IMAGE_PROFILE } from "./images/pipeline/image-profile";
  import type { ImageInsertionConfig } from "./editor/image-insertion";
  import {
    IMAGE_COUNT_LIMIT_MESSAGE,
    describeAddingImages,
    describeImageRejections,
  } from "./ui/images/image-messages";
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
  import ScreenScope from "./ui/dialogs/ScreenScope.svelte";
  import PrintView from "./ui/print/PrintView.svelte";
  import type { PrintNote } from "./ui/print/print-note";
  import Wordmark from "./ui/wordmark/Wordmark.svelte";
  import type { InstallController } from "./app/install-controller";
  import type { LaunchActions } from "./app/launch-action";
  import { emptyEarlyDraft, isUntouched, type EarlyDraft } from "./app/early-draft";
  import { earlyDraftLoadStatus } from "./app/early-draft-load-status";
  import type { SyncError } from "./sync/sync-engine";
  import { installTypeToStart } from "./ui/browse/type-to-start";
  import FloatingNewNoteButton from "./ui/browse/FloatingNewNoteButton.svelte";
  import EarlyDraftView from "./ui/note/EarlyDraftView.svelte";
  import {
    DEFAULT_SETTING_SCOPES,
    type SwitchableSettingKey,
  } from "./settings/setting-scope";
  import { SETTINGS_SCHEMA, type Settings } from "./settings/settings";
  import InstallBar from "./ui/install/InstallBar.svelte";
  import InstallHowToDialog from "./ui/install/InstallHowToDialog.svelte";
  import { createDialogEntries } from "./ui/dialogs/dialog-entries";
  import { bindDialogHistory, type DialogHistory } from "./ui/dialogs/dialog-history";
  import { dialogStack } from "./ui/dialogs/dialog-stack";
  import { setStandalone } from "./ui/standalone-context";
  import { readPlatformInputs } from "./app/platform-inputs";
  import { effectiveDeviceName } from "./settings/device-name";
  import type { DesktopShell } from "./desktop/desktop-shell-types";

  interface Props {
    registry: ForgeRegistry;
    testModeBanner: string | null;
    argon2id?: Argon2idFunction;
    appUpdates: AppUpdates | null;
    install: InstallController;
    launchActions: LaunchActions;
    standalone: boolean;
    desktop?: DesktopShell | null;
  }

  const {
    registry,
    testModeBanner,
    argon2id,
    appUpdates,
    install,
    launchActions,
    standalone,
    desktop = null,
  }: Props = $props();

  setStandalone(untrack(() => standalone));

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
        readonly running: RunningApp<WebServices>;
        readonly engine: SyncEngine;
        readonly autoRefresh: AutoRefresh;
        readonly settingsSaver: SettingsSaver;
        readonly contentIndexer: ContentIndexer;
        readonly session: Session;
        readonly remembered: boolean;
        readonly passphraseChange: PassphraseChange;
        readonly noteHistory: NoteHistory;
        readonly imageResolver: ImageResolver;
        readonly shareService: ShareService;
        readonly noteDatesResolver: NoteDatesResolver;
        readonly initialMessage: Pick<ToastMessage, "tone" | "text"> | null;
        readonly repoLabel: string;
        readonly repoUrl: string;
        readonly forgeName: string;
      };

  interface WebServices {
    readonly passphraseChange: PassphraseChange;
    readonly noteHistory: NoteHistory;
    readonly imageResolver: ImageResolver;
    readonly shareService: ShareService;
    readonly noteDatesResolver: NoteDatesResolver;
  }

  const platformPorts = createBrowserPlatformPorts();
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
  let autoUpdate: AutoUpdate | null = null;
  let updateView: UpdateView | null = null;
  let keyChanged = $state<{ readonly unsavedCount: number } | null>(null);
  let appRefreshError = $state.raw<SyncError | null>(null);
  let appTreeLoaded = $state(false);

  const deviceSettingsStore = createDeviceSettingsStore();
  onMount(() => () => deviceSettingsStore.dispose());

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

  const platformInputs = readPlatformInputs(untrack(() => standalone));
  const currentDeviceName = () =>
    effectiveDeviceName(deviceSettingsStore.readDeviceName(), platformInputs);

  function loginDeps() {
    return {
      createAdapter: budgetedCreateAdapter,
      argon2id,
      deviceName: currentDeviceName,
    };
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

  function createWebServices(context: AppServicesContext): WebServices {
    const { session, sourceAdapter, adapter, engine, rateBudget, clock } = context;
    const noteHistory = createNoteHistory({ adapter, keyring: session.keyring });
    const imageResolver = createImageResolver({
      keyring: session.keyring,
      adapter,
      engine: {
        getPendingImage: (id) => engine.getPendingImage(id),
        getRestoredImageSha: (id) => engine.getRestoredImageSha(id),
        getImageIndex: () => engine.getState().synced?.images ?? null,
      },
    });
    return {
      passphraseChange: createPassphraseChange({
        adapter,
        engine,
        rateBudget,
        clock,
        argon2id,
        deviceName: currentDeviceName,
      }),
      noteHistory,
      imageResolver,
      shareService: createShareService({
        engine,
        shareHost: sourceAdapter.shareHost,
        noteHistory,
        images: {
          read: (id) => imageResolver.readPayload(id),
          reencode: async (p) =>
            (await loadImagePipeline()).processImageInBrowser(
              new Blob([p.bytes as BlobPart], { type: p.type }),
              SHARE_IMAGE_PROFILE,
            ),
        },
        rateBudget,
        clock,
        argon2id: argon2id ?? argon2idInWorker,
        linkBase: platformPorts.navigation.shareLinkBase(),
      }),
      noteDatesResolver: createNoteDates({
        adapter,
        keyring: session.keyring,
        clock,
      }),
    };
  }

  const appDeps: StartAppDeps<WebServices> = {
    store,
    ports: platformPorts,
    clock: systemClock,
    rateBudgetFor,
    deviceName: currentDeviceName,
    get requestPersistentStorageOnResume() {
      return standalone;
    },
    installLifecycle: (handlers) => installLifecycleTriggers({ window, document }, handlers),
    createServices: createWebServices,
    disposeServices: (services) => {
      services.imageResolver.dispose();
      clearEarlyDraftImages();
    },
    extraHasUnsaved: () => earlyDraftNeedsGuard(),
    onRefreshTrigger: () => appUpdates?.checkForUpdate(),
    afterStart: ({ hasUnsaved, flush, onUnsavedChange, hasSettledUnsaved }) => {
      const stopAutoUpdateWatch = onUnsavedChange(() => autoUpdate?.evaluate());
      const uninstallCloseGuard =
        desktop?.installCloseGuard({
          hasUnsaved,
          flush,
          onUnsavedChange,
          hasSettledUnsaved,
        }) ?? null;
      return () => {
        stopAutoUpdateWatch();
        uninstallCloseGuard?.();
      };
    },
    onKeyChanged: (state) => {
      keyChanged = state;
      if (state !== null) resetReported();
    },
    onRefreshState: (state) => {
      appRefreshError = state.lastError;
      appTreeLoaded = state.treeLoaded;
    },
    beforeEngine: (session, remembered) => {
      earlyDraftBacking = remembered
        ? {
            repoKey: repoKeyOf(session.coordinates),
            keyring: session.keyring,
          }
        : null;
      useEarlyDraftKeyring(session.keyring);
    },
  };

  async function startApp(
    session: Session,
    adapter: ForgeAdapter,
    rememberMe: boolean,
    initialMessage: Pick<ToastMessage, "tone" | "text"> | null = null,
    purgeBlobCache = false,
    resumed = false,
    knownHead?: string,
  ): Promise<void> {
    phase = { kind: "restoring" };
    const running = await startRunningApp(appDeps, {
      session,
      adapter,
      rememberMe,
      resumed,
      purgeBlobCache,
      ...(knownHead === undefined ? {} : { knownHead }),
    });
    phase = {
      kind: "app",
      running,
      engine: running.engine,
      autoRefresh: running.autoRefresh,
      settingsSaver: running.settingsSaver,
      contentIndexer: running.contentIndexer,
      session,
      remembered: running.remembered,
      ...running.services,
      initialMessage,
      repoLabel: repositoryLabel(session.coordinates),
      repoUrl: session.repoUrl,
      forgeName: registry[session.coordinates.forge].name,
    };
  }

  async function handleLoggedIn(result: {
    session: Session;
    adapter: ForgeAdapter;
    rememberMe: boolean;
  }): Promise<void> {
    const carried = earlyDraft !== null && !isUntouched(earlyDraft);
    const started = startApp(result.session, result.adapter, result.rememberMe);
    if (carried) earlyDraftOpen = true;
    await started;
  }

  async function handlePassphraseChanged(
    keyring: Keyring,
    check: LandedCheck,
    history: HistoryOutcome,
  ): Promise<void> {
    if (phase.kind !== "app") return;
    const { running } = phase;
    await stopRunningApp(running, { clearBlobCache: false });
    await startApp(
      { ...running.session, keyring },
      running.sourceAdapter,
      running.rememberMe,
      describePassphraseChanged(check, history),
      true,
    );
  }

  async function finishLogOut(clearStore = true): Promise<void> {
    if (phase.kind !== "app") return;
    const { running, session } = phase;
    await stopRunningApp(running, { clearBlobCache: true });
    earlyDraftBacking = null;
    if (clearStore) {
      await store.clear();
      await discardEarlyDraftData();
    }
    removeLastView(repoKeyOf(session.coordinates));
    logout = null;
    platformPorts.navigation.clearNoteFragment();
    showLogin(null);
  }

  // Another tab of this browser profile may have changed the passphrase and
  // remembered the new keys; those are used instead of asking to log in.
  async function logInAfterKeyChange(): Promise<void> {
    if (phase.kind !== "app") return;
    const { running, session } = phase;
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
      await stopRunningApp(running, { clearBlobCache: true });
      await startApp(
        result.session,
        result.adapter,
        true,
        null,
        false,
        false,
        result.head,
      );
      return;
    }
    await finishLogOut(!isTransient(result.error));
  }

  async function attemptLogOut(): Promise<void> {
    if (phase.kind !== "app") return;
    logout = { kind: "saving" };
    const result = await flushBeforeLogOut(phase);
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

  let earlyDraft = $state<EarlyDraft | null>(null);
  let earlyDraftOpen = $state(false);
  let earlyDraftOffered = $state(false);
  let earlyDraftView = $state<ReturnType<typeof EarlyDraftView> | undefined>();
  let earlyDraftHandingOff = $state(false);
  let earlyDraftBacking = $state.raw<{
    readonly repoKey: string;
    readonly keyring: Keyring;
  } | null>(null);
  let earlyDraftStore = createEarlyDraftStore();
  let earlyDraftStoreQueue: Promise<unknown> = Promise.resolve();

  function queueEarlyDraftStore<T>(task: () => Promise<T>): Promise<T> {
    const result = earlyDraftStoreQueue.then(task, task);
    earlyDraftStoreQueue = result.catch(() => undefined);
    return result;
  }

  let earlyDraftKeyring = $state.raw<Keyring | null>(null);
  let earlyDraftImages = $state.raw<ReadonlyMap<ImageId, PendingImage>>(new Map());
  let earlyDraftResolver = $state.raw<ImageResolver | null>(null);
  let earlyDraftImageNotice = $state<string | null>(null);
  let earlyDraftImageNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  const EARLY_DRAFT_IMAGE_NOTICE_MS = 10_000;

  function showEarlyDraftImageNotice(text: string | null): void {
    clearTimeout(earlyDraftImageNoticeTimer);
    earlyDraftImageNotice = text;
    if (text !== null) {
      earlyDraftImageNoticeTimer = setTimeout(
        () => (earlyDraftImageNotice = null),
        EARLY_DRAFT_IMAGE_NOTICE_MS,
      );
    }
  }

  function useEarlyDraftKeyring(keyring: Keyring): void {
    earlyDraftKeyring = keyring;
    if (earlyDraftResolver !== null) return;
    earlyDraftResolver = createImageResolver({
      keyring,
      adapter: { readBlobBytes: () => Promise.reject(new Error("unavailable")) },
      engine: {
        getPendingImage: (id) => earlyDraftImages.get(id),
        getRestoredImageSha: () => undefined,
        getImageIndex: () => null,
      },
    });
  }

  const handoffImages = $derived([...earlyDraftImages.values()]);

  function clearEarlyDraftImages(): void {
    earlyDraftResolver?.dispose();
    earlyDraftResolver = null;
    earlyDraftKeyring = null;
    earlyDraftImages = new Map();
    showEarlyDraftImageNotice(null);
  }

  const earlyDraftImageInsertion: ImageInsertionConfig = {
    prepare: (files) =>
      prepareImages(files, {
        keyring: earlyDraftKeyring!,
        process: async () => (await loadImagePipeline()).processImageInBrowser,
      }),
    register: (image) => {
      earlyDraftImages = new Map(earlyDraftImages).set(image.imageId, image);
    },
    enabled: () => earlyDraftKeyring !== null,
    onBusy: (busy, count) =>
      showEarlyDraftImageNotice(busy ? describeAddingImages(count) : null),
    onOutcome: (outcome) => {
      if (outcome.kind === "tooMany") {
        showEarlyDraftImageNotice(IMAGE_COUNT_LIMIT_MESSAGE);
        return;
      }
      showEarlyDraftImageNotice(describeImageRejections(outcome.rejections, outcome.total));
    },
  };

  async function discardEarlyDraftData(): Promise<void> {
    earlyDraftBacking = null;
    clearEarlyDraftImages();
    await queueEarlyDraftStore(async () => {
      await deleteEarlyDraftDatabase();
      earlyDraftStore = createEarlyDraftStore();
    });
  }

  $effect(() => {
    const backing = earlyDraftBacking;
    const draft = earlyDraft;
    const images = earlyDraftImages;
    if (backing === null) return;
    if (draft === null || isUntouched(draft)) {
      void queueEarlyDraftStore(() => earlyDraftStore.remove(backing.repoKey));
      return;
    }
    const save = () => {
      const referenced = referencedImageIds(draft.body);
      const kept = [...images.values()].filter((image) => referenced.has(image.imageId));
      void queueEarlyDraftStore(() =>
        earlyDraftStore.save(backing.repoKey, backing.keyring, draft, kept),
      );
    };
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      save();
    }, EARLY_DRAFT_SAVE_DEBOUNCE_MS);
    const flush = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      save();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  });

  const earlyDraftShown = $derived(
    earlyDraft !== null && earlyDraftOpen && !earlyDraftHandingOff,
  );

  $effect(() => {
    if (phase.kind !== "restoring") earlyDraftOffered = false;
  });

  function deviceScopedSetting<K extends SwitchableSettingKey>(
    key: K,
  ): Settings[K] | undefined {
    const record = deviceSettingsStore.read();
    const scope = record.scopes[key] ?? DEFAULT_SETTING_SCOPES[key];
    return scope === "device" ? record.values[key] : undefined;
  }

  function typeToStartDeviceEnabled(): boolean {
    const record = deviceSettingsStore.read();
    const scope = record.scopes.typeToStart ?? DEFAULT_SETTING_SCOPES.typeToStart;
    if (scope !== "device") return false;
    return record.values.typeToStart ?? SETTINGS_SCHEMA.typeToStart.default;
  }

  function openEarlyDraft(): void {
    if (earlyDraft === null) earlyDraft = emptyEarlyDraft("name");
    earlyDraftOpen = true;
  }

  function handleEarlyDraftHandedOff(): void {
    const backing = earlyDraftBacking;
    if (backing !== null) {
      void queueEarlyDraftStore(() => earlyDraftStore.remove(backing.repoKey));
    }
    clearEarlyDraftImages();
    earlyDraftHandingOff = true;
    flushSync();
    // The view stays mounted until the app has moved focus into its own draft.
    queueMicrotask(() => {
      earlyDraft = null;
      earlyDraftOpen = false;
      earlyDraftHandingOff = false;
    });
  }

  function earlyDraftNeedsGuard(): boolean {
    return (
      earlyDraft !== null &&
      !isUntouched(earlyDraft) &&
      earlyDraftBacking === null
    );
  }

  onMount(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!earlyDraftNeedsGuard()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  function registerUpdateView(view: UpdateView): () => void {
    updateView = view;
    autoUpdate?.evaluate();
    return () => {
      if (updateView === view) updateView = null;
    };
  }

  function updateHasUnsaved(): boolean {
    if (earlyDraftNeedsGuard()) return true;
    if (phase.kind !== "app") return false;
    return (
      phase.settingsSaver.hasPending ||
      phase.engine.getState().syncStates.hasUnsaved
    );
  }

  function updateCanReload(): boolean {
    if (phase.kind !== "app" || !phase.remembered || keyChanged !== null) {
      return false;
    }
    const state = phase.engine.getState();
    if (state.importing || state.suspended) return false;
    return !(updateView?.busy() ?? false);
  }

  function updateOverlayOpen(): boolean {
    return (
      (earlyDraft !== null && earlyDraftOpen) ||
      dialogStack.top() !== null ||
      document.querySelector('[role="menu"]') !== null
    );
  }

  onMount(() => {
    if (appUpdates === null) return;
    const auto = installAutoUpdate(
      { window, document },
      {
        updates: appUpdates,
        clock: systemClock,
        reloadGuard: createReloadGuard(browserSessionStorage(), systemClock),
        reload: () => location.reload(),
        host: {
          hasUnsaved: updateHasUnsaved,
          canReload: updateCanReload,
          overlayOpen: updateOverlayOpen,
          editing: () => document.hasFocus() && isEditableElement(document.activeElement),
          hidden: () => document.visibilityState === "hidden",
          prepareReload: () => updateView?.saveResume() ?? Promise.resolve(),
        },
      },
    );
    autoUpdate = auto;
    const stopDialogWatch = dialogStack.subscribe(() => auto.evaluate());
    return () => {
      stopDialogWatch();
      auto.dispose();
      autoUpdate = null;
    };
  });

  function closeEarlyDraft(): void {
    if (earlyDraft !== null && isUntouched(earlyDraft)) earlyDraft = null;
    earlyDraftOpen = false;
  }

  $effect(() => {
    if (!earlyDraftOffered) return;
    return launchActions.attach(openEarlyDraft, (action) => action === "new-note");
  });

  $effect(() => {
    if (!earlyDraftOffered) return;
    const typeToStart = installTypeToStart(window, {
      scene: () => ({
        enabled:
          typeToStartDeviceEnabled() &&
          !earlyDraftOpen &&
          (earlyDraft === null || isUntouched(earlyDraft)),
        placeholderVisible: true,
        engineStopped: false,
        dialogOpen: false,
        menuOpen: false,
        body: document.body,
        notePane: null,
      }),
      start: () => {
        earlyDraft = emptyEarlyDraft("body");
        earlyDraftOpen = true;
        void tick().then(() => earlyDraftView?.insertBodyText(typeToStart.drain()));
      },
    });
    return () => typeToStart.dispose();
  });

  const EARLY_DRAFT_SAVE_DEBOUNCE_MS = 300;

  let resumeError = $state.raw<LoginError | null>(null);
  let resumeForgeName = $state("");

  const earlyDraftStatus = $derived(
    earlyDraftLoadStatus({
      resumeError,
      phase: phase.kind,
      refreshError: appRefreshError,
      treeLoaded: appTreeLoaded,
      keyChanged: keyChanged !== null,
      sessionRemembered: phase.kind === "app" ? phase.remembered : true,
      forgeName: phase.kind === "app" ? phase.forgeName : resumeForgeName,
    }),
  );

  function leaveToLogin(error: LoginError | null): void {
    earlyDraftOffered = false;
    closeEarlyDraft();
    showLogin(error);
  }

  async function loadEarlyDraftFor(session: Session): Promise<void> {
    const backing = {
      repoKey: repoKeyOf(session.coordinates),
      keyring: session.keyring,
    };
    const stored = await queueEarlyDraftStore(() =>
      earlyDraftStore.load(backing.repoKey, backing.keyring),
    );
    earlyDraftBacking = backing;
    useEarlyDraftKeyring(session.keyring);
    if (stored !== null && (earlyDraft === null || isUntouched(earlyDraft))) {
      earlyDraftImages = new Map(stored.images.map((image) => [image.imageId, image]));
      earlyDraft = stored.draft;
      earlyDraftOpen = true;
    }
    earlyDraftOffered = true;
    resumeForgeName = registry[session.coordinates.forge].name;
  }

  async function clearRememberedData(session: Session | null): Promise<void> {
    if (session !== null) {
      await store.clear();
      removeLastView(repoKeyOf(session.coordinates));
    }
    await deleteBlobCacheDatabase();
    await discardEarlyDraftData();
  }

  async function resumeRemembered(): Promise<void> {
    try {
      const result = await resumeRememberedSession({
        store,
        loginDeps: loginDeps(),
        onSessionLoaded: loadEarlyDraftFor,
        clearAfterFailure: clearRememberedData,
      });
      switch (result.kind) {
        case "none":
          leaveToLogin(null);
          return;
        case "loggedIn":
          await startApp(
            result.session,
            result.adapter,
            true,
            null,
            false,
            true,
            result.head,
          );
          return;
        case "failed": {
          if (earlyDraft === null || isUntouched(earlyDraft)) {
            leaveToLogin(result.error);
            return;
          }
          resumeError = result.error;
          earlyDraftOpen = true;
          if (!result.transient) showLogin(result.error);
        }
      }
    } catch (e) {
      console.error(e);
      leaveToLogin(null);
    }
  }

  function retryResume(): void {
    resumeError = null;
    void resumeRemembered();
  }

  async function logInFromEarlyDraft(): Promise<void> {
    if (keyChanged !== null) {
      await logInAfterKeyChange();
      if (phase.kind === "login") earlyDraftOpen = false;
      return;
    }
    const error = resumeError;
    resumeError = null;
    earlyDraftOpen = false;
    if (phase.kind !== "login") showLogin(error);
  }

  onMount(() => {
    void resumeRemembered();
  });
</script>

{#if testModeBanner !== null}
  <p class="notice test-mode-banner" role="note">{testModeBanner}</p>
{/if}

<div
  class="phase-content"
  inert={earlyDraftShown}
  aria-hidden={earlyDraftShown ? "true" : undefined}
>
{#if phase.kind === "restoring"}
  <main class="restoring window-drag">
    <Wordmark element="h1" />
    <p class="restoring-text">Loading…</p>
  </main>
  {#if earlyDraftOffered && !earlyDraftOpen}
    <FloatingNewNoteButton
      state="extended"
      aboveFooter={false}
      onNewNote={openEarlyDraft}
    />
  {/if}
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
      unsavedNote={earlyDraft !== null &&
      !isUntouched(earlyDraft) &&
      !earlyDraftOpen
        ? { name: earlyDraft.name, body: earlyDraft.body }
        : null}
      {deviceSettingsStore}
      onAccentColor={(id) => (reportedAccentColor = id)}
      onColorMode={(id) => (reportedColorMode = id)}
    />
  {/key}
{:else if phase.kind === "app" && keyChanged !== null}
  <KeyChangedScreen
    engine={phase.engine}
    unsavedCount={keyChanged.unsavedCount}
    onLogInAgain={() => void logInAfterKeyChange()}
    download={desktop?.download}
  />
{:else if phase.kind === "app"}
  <ScreenScope current={() => phase.kind === "app" && keyChanged === null}>
    <AppShell
      engine={phase.engine}
      autoRefresh={phase.autoRefresh}
      settingsSaver={phase.settingsSaver}
      {deviceSettingsStore}
      {registerUpdateView}
      {install}
      {launchActions}
      download={desktop?.download}
      contentIndexer={phase.contentIndexer}
      repoLabel={phase.repoLabel}
      repoUrl={phase.repoUrl}
      forgeName={phase.forgeName}
      passphraseChange={phase.passphraseChange}
      noteHistory={phase.noteHistory}
      imageSource={phase.imageResolver.resolve}
      readImage={phase.imageResolver.readPayload}
      shareService={phase.shareService}
      forgeId={phase.session.coordinates.forge}
      noteDatesResolver={phase.noteDatesResolver}
      keyring={phase.session.keyring}
      repoKey={repoKeyOf(phase.session.coordinates)}
      sessionRemembered={phase.remembered}
      initialMessage={phase.initialMessage}
      {earlyDraft}
      earlyDraftImages={handoffImages}
      onEarlyDraftHandedOff={handleEarlyDraftHandedOff}
      onPassphraseChanged={(keyring, check, history) =>
        void handlePassphraseChanged(keyring, check, history)}
      onLogOut={logOut}
      onAccentColor={(id) => (reportedAccentColor = id)}
      onColorMode={(id) => (reportedColorMode = id)}
      onNoteFont={(id) => (reportedNoteFont = id)}
      onPrintNote={(note) => (reportedPrintNote = note)}
    />
  </ScreenScope>
{/if}
</div>

{#if earlyDraft !== null && earlyDraftOpen}
  <EarlyDraftView
    bind:this={earlyDraftView}
    draft={earlyDraft}
    onChange={(next) => (earlyDraft = next)}
    onBack={closeEarlyDraft}
    showBack={earlyDraftStatus.kind !== "failed" ||
      earlyDraftStatus.actions.length === 0 ||
      isUntouched(earlyDraft)}
    noteFont={deviceScopedSetting("noteFont") ?? SETTINGS_SCHEMA.noteFont.default}
    animatedCaret={deviceScopedSetting("animatedCaret") ?? SETTINGS_SCHEMA.animatedCaret.default}
    imageInsertion={earlyDraftKeyring === null ? null : earlyDraftImageInsertion}
    imageSource={earlyDraftResolver?.resolve ?? null}
    imageNotice={earlyDraftImageNotice}
  >
    {#snippet status()}
      {#if earlyDraftStatus.kind === "failed"}
        <div class="early-draft-failure" role="alert">
          <p>{earlyDraftStatus.message}</p>
          {#if earlyDraftStatus.notSavedYet}
            <p>This note is not saved yet.</p>
          {/if}
          {#if earlyDraftStatus.actions.length > 0}
            <div class="early-draft-actions">
              {#if earlyDraftStatus.actions.includes("tryAgain")}
                <button type="button" class="button" onclick={retryResume}>Try again</button>
              {/if}
              {#if earlyDraftStatus.actions.includes("logIn")}
                <button
                  type="button"
                  class="button"
                  onclick={() => void logInFromEarlyDraft()}
                >
                  Log in
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <p class="early-draft-loading" role="status">Loading notes…</p>
      {/if}
    {/snippet}
  </EarlyDraftView>
{/if}

<LogoutDialog
  open={logout !== null && phase.kind === "app" && keyChanged === null}
  saving={logout?.kind !== "unsaved"}
  unsavedCount={logout?.kind === "unsaved" ? logout.count : 0}
  onKeepTrying={attemptLogOut}
  onLogOutAnyway={finishLogOut}
/>

<InstallHowToDialog
  open={installState.howToOpen}
  onClose={() => install.closeHowTo()}
/>

<PrintView
  note={phase.kind === "app" && keyChanged === null ? reportedPrintNote : null}
  readImage={phase.kind === "app" && keyChanged === null ? phase.imageResolver.readPayload : null}
/>

<style>
  .test-mode-banner {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-xs);
    letter-spacing: 0.02em;
    padding: var(--space-1) var(--space-3);
  }

  .phase-content {
    display: contents;
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

  .early-draft-loading {
    margin: 0;
    padding: var(--space-2) var(--space-3) 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .early-draft-failure {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: var(--hairline) solid var(--color-border);
    font-size: var(--font-size-sm);
  }

  .early-draft-failure p {
    margin: 0;
  }

  .early-draft-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .restoring-text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  @media (display-mode: window-controls-overlay) {
    .restoring {
      padding-top: max(
        calc(var(--space-4) + env(safe-area-inset-top)),
        calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 0px))
      );
    }
  }
</style>
