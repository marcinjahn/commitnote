import { repoKeyOf, type BlobCache } from "../blob-cache/blob-cache";
import {
  createCachedTreeStore,
  hasCachedTree,
} from "../blob-cache/cached-tree";
import { withBlobCache } from "../blob-cache/caching-adapter";
import type { ForgeAdapter } from "../forge/forge-adapter";
import type { ForgeId } from "../forge/repo-coordinates";
import {
  createContentIndexer,
  type ContentIndexer,
} from "../search/content-indexer";
import { createIndexerEnvironment } from "../search/indexer-environment";
import type { SessionStore, StorageLike } from "../session/session-store";
import type { Session } from "../session/session";
import {
  createSettingsSaver,
  type SettingsSaver,
} from "../settings/settings-saver";
import type { Clock } from "../sync/clock";
import type { RateBudget } from "../sync/rate-budget";
import {
  createSyncEngine,
  type SyncEngine,
  type SyncError,
} from "../sync/sync-engine";
import {
  SETTINGS_SAVE_DEBOUNCE_MS,
  SETTINGS_SAVE_MAX_WAIT_MS,
} from "../sync/tuning";
import { createAutoRefresh, type AutoRefresh } from "./auto-refresh";
import {
  openSessionBlobCache,
  purgeBlobCacheNow,
  purgeBlobCacheWhenIndexed,
  saveCachedTreeOnChange,
  type BlobStoreProvider,
} from "./blob-cache-lifecycle";
import type { LifecycleHandlers } from "./lifecycle-triggers";
import type { PlatformPorts } from "./platform-ports";

export interface AppServicesContext {
  readonly session: Session;
  readonly sourceAdapter: ForgeAdapter;
  readonly adapter: ForgeAdapter;
  readonly engine: SyncEngine;
  readonly rateBudget: RateBudget;
  readonly clock: Clock;
}

export interface AfterStartContext {
  readonly engine: SyncEngine;
  readonly settingsSaver: SettingsSaver;
  onUnsavedChange(listener: () => void): () => void;
}

export interface StartAppDeps<S = undefined> {
  readonly store: SessionStore;
  readonly ports: PlatformPorts;
  readonly clock: Clock;
  rateBudgetFor(forge: ForgeId, adapter: ForgeAdapter): RateBudget;
  readonly deviceName: () => string;
  readonly requestPersistentStorageOnResume: boolean;
  readonly blobStore?: BlobStoreProvider;
  /** Holds the pointer to the cached tree; defaults to localStorage. */
  readonly deviceStorage?: StorageLike | null;
  installLifecycle(handlers: LifecycleHandlers): () => void;
  createServices?(context: AppServicesContext): S;
  disposeServices?(services: S): void;
  readonly extraHasUnsaved?: () => boolean;
  readonly onRefreshTrigger?: (trigger: "visible" | "online") => void;
  afterStart?(context: AfterStartContext): () => void;
  onKeyChanged(state: { readonly unsavedCount: number } | null): void;
  onRefreshState(state: {
    readonly lastError: SyncError | null;
    readonly treeLoaded: boolean;
  }): void;
  beforeEngine?(session: Session, remembered: boolean): void;
}

export interface StartAppInput {
  readonly session: Session;
  readonly adapter: ForgeAdapter;
  readonly rememberMe: boolean;
  readonly resumed: boolean;
  readonly knownHead?: string;
  readonly purgeBlobCache: boolean;
}

export interface RunningApp<S = undefined> {
  readonly session: Session;
  readonly sourceAdapter: ForgeAdapter;
  readonly adapter: ForgeAdapter;
  readonly engine: SyncEngine;
  readonly autoRefresh: AutoRefresh;
  readonly settingsSaver: SettingsSaver;
  readonly contentIndexer: ContentIndexer;
  readonly blobCache: BlobCache | null;
  readonly rememberMe: boolean;
  readonly remembered: boolean;
  readonly services: S;
  /** The first refresh, still running in the background when the app started from the cached tree. */
  readonly startupRefresh: Promise<void> | null;
  readonly teardown: (clearBlobCache: boolean) => Promise<void>;
}

export function startApp<S>(
  deps: StartAppDeps<S>,
  input: StartAppInput,
): Promise<RunningApp<S>> {
  return launch(deps, input, false);
}

/**
 * Starts a remembered session from the tree cached on this device, refreshing
 * from the forge in the background. Resolves null, leaving nothing running,
 * when no usable cached tree exists.
 */
export function startAppFromCache<S>(
  deps: StartAppDeps<S>,
  input: Omit<StartAppInput, "knownHead" | "rememberMe" | "resumed">,
): Promise<RunningApp<S> | null> {
  return launch(deps, { ...input, rememberMe: true, resumed: true }, true);
}

function launch<S>(
  deps: StartAppDeps<S>,
  input: StartAppInput,
  fromCache: false,
): Promise<RunningApp<S>>;
function launch<S>(
  deps: StartAppDeps<S>,
  input: StartAppInput,
  fromCache: true,
): Promise<RunningApp<S> | null>;
async function launch<S>(
  deps: StartAppDeps<S>,
  input: StartAppInput,
  fromCache: boolean,
): Promise<RunningApp<S> | null> {
  const { store, ports, clock } = deps;
  const { session, adapter, rememberMe } = input;
  if (
    fromCache &&
    !hasCachedTree(repoKeyOf(session.coordinates), deps.deviceStorage)
  ) {
    return null;
  }

  const { remembered } = await store.start(session, { rememberMe });
  deps.beforeEngine?.(session, remembered);
  if (remembered && (!input.resumed || deps.requestPersistentStorageOnResume)) {
    void ports.persistentStorage?.request();
  }
  const blobCache = await openSessionBlobCache({
    remembered,
    coordinates: session.coordinates,
    clock,
    ...(deps.blobStore === undefined ? {} : { blobStore: deps.blobStore }),
  });
  const cachedAdapter =
    blobCache === null ? adapter : withBlobCache(adapter, blobCache);

  const rateBudget = deps.rateBudgetFor(
    session.coordinates.forge,
    cachedAdapter,
  );
  const engine = createSyncEngine({
    adapter: cachedAdapter,
    keyring: session.keyring,
    clock,
    rateBudget,
    isOnline: () => ports.connectivity.isOnline(),
    deviceName: deps.deviceName,
    ...(blobCache === null ? {} : { blobCache }),
  });
  const cachedTreeStore =
    blobCache === null
      ? null
      : createCachedTreeStore({
          cache: blobCache,
          repoKey: repoKeyOf(session.coordinates),
          ...(deps.deviceStorage === undefined
            ? {}
            : { storage: deps.deviceStorage }),
        });
  let restoredHead: string | null = null;
  if (fromCache) {
    const cached = (await cachedTreeStore?.load()) ?? null;
    if (cached === null || !(await engine.restoreCached(cached))) {
      engine.dispose();
      await blobCache?.dispose();
      return null;
    }
    restoredHead = cached.head;
  }
  const stopSavingCachedTree =
    cachedTreeStore === null
      ? null
      : saveCachedTreeOnChange({
          engine,
          store: cachedTreeStore,
          clock,
          savedHead: restoredHead,
        });
  const contentIndexer = createContentIndexer({
    engine,
    clock,
    environment: createIndexerEnvironment(ports),
  });
  const uninstallBlobCachePurge =
    blobCache === null
      ? null
      : purgeBlobCacheWhenIndexed({
          indexer: contentIndexer,
          engine,
          cache: blobCache,
          clock,
        });
  const settingsSaver = createSettingsSaver({
    clock,
    debounceMs: SETTINGS_SAVE_DEBOUNCE_MS,
    maxWaitMs: SETTINGS_SAVE_MAX_WAIT_MS,
    stored: () => engine.getState().rawSettings,
    save: (edits) => engine.changeSettings(edits),
  });
  const unsubscribeEngine = engine.subscribe((state) => {
    deps.onRefreshState({
      lastError: state.refresh.lastError,
      treeLoaded: state.workingTree !== null,
    });
    deps.onKeyChanged(
      state.stopped?.kind === "keyChanged"
        ? { unsavedCount: state.syncStates.unsavedCount }
        : null,
    );
  });

  let autoRefresh: AutoRefresh | null = null;
  const hasUnsaved = () =>
    settingsSaver.hasPending ||
    engine.getState().syncStates.hasUnsaved ||
    (deps.extraHasUnsaved?.() ?? false);
  const flush = () => {
    settingsSaver.flush();
    void engine.flush();
  };
  const uninstallLifecycle = deps.installLifecycle({
    flush,
    retryNow: () => engine.retryNow(),
    setOnline: (online) => engine.setOnline(online),
    setVisible: (visible) => autoRefresh?.setVisible(visible),
    refreshTrigger: (trigger) => {
      autoRefresh?.trigger(trigger);
      deps.onRefreshTrigger?.(trigger);
    },
    hasUnsaved,
  });
  const onUnsavedChange = (listener: () => void) => {
    const stopEngine = engine.subscribe(() => listener());
    const stopSaver = settingsSaver.subscribe(listener);
    return () => {
      stopEngine();
      stopSaver();
    };
  };
  const disposeAfterStart =
    deps.afterStart?.({ engine, settingsSaver, onUnsavedChange }) ?? null;

  // Forge errors resolve with `refresh.lastError` set, which the shell shows.
  let refreshed = true;
  if (!fromCache) {
    try {
      await engine.refresh({ knownHead: input.knownHead });
    } catch (e) {
      console.error(e);
      refreshed = false;
    }
  }

  const refreshScheduler = createAutoRefresh({
    refresh: () => engine.refresh(),
    lastError: () => engine.getState().refresh.lastError,
    canRefresh: () => {
      const s = engine.getState();
      return (
        ports.visibility.isVisible() &&
        s.online &&
        s.stopped === null &&
        !s.suspended &&
        !s.importing &&
        !s.refresh.inFlight &&
        !engine.hasLocalWork()
      );
    },
    observedRateLimit: () => cachedAdapter.observedRateLimit?.() ?? null,
    clock,
    visible: ports.visibility.isVisible(),
  });
  autoRefresh = refreshScheduler;

  const services = (deps.createServices?.({
    session,
    sourceAdapter: adapter,
    adapter: cachedAdapter,
    engine,
    rateBudget,
    clock,
  }) ?? undefined) as S;

  let stopped = false;
  const runStartupMaintenance = () => {
    try {
      engine.purgeExpiredTrash();
    } catch {
      console.error("Trash purge failed");
    }
    try {
      engine.sweepOrphanImages();
    } catch {
      console.error("Image sweep failed");
    }
    cachedAdapter.sweepAbandoned?.().catch(() => {
      console.error("Sweeping abandoned atomic commits failed");
    });
    if (input.purgeBlobCache && blobCache !== null) {
      purgeBlobCacheNow({ engine, cache: blobCache, clock });
    }
  };

  let startupRefresh: Promise<void> | null = null;
  if (!fromCache) {
    if (refreshed) runStartupMaintenance();
  } else {
    // Maintenance needs the forge's current tree; with local work the
    // restored tree stays until the save merges, so it waits for a later start.
    startupRefresh = engine.refresh().then(
      () => {
        const state = engine.getState();
        if (
          !stopped &&
          state.refresh.lastError === null &&
          !engine.hasLocalWork()
        ) {
          runStartupMaintenance();
        }
      },
      (e: unknown) => {
        console.error(e);
      },
    );
  }

  const teardown = (clearBlobCache: boolean): Promise<void> => {
    stopped = true;
    stopSavingCachedTree?.();
    uninstallLifecycle();
    disposeAfterStart?.();
    refreshScheduler.dispose();
    autoRefresh = null;
    uninstallBlobCachePurge?.();
    unsubscribeEngine();
    deps.onKeyChanged(null);
    deps.onRefreshState({ lastError: null, treeLoaded: false });
    settingsSaver.dispose();
    contentIndexer.dispose();
    deps.disposeServices?.(services);
    engine.dispose();
    if (blobCache === null) return Promise.resolve();
    return clearBlobCache ? blobCache.clear() : blobCache.dispose();
  };

  return {
    session,
    sourceAdapter: adapter,
    adapter: cachedAdapter,
    engine,
    autoRefresh: refreshScheduler,
    settingsSaver,
    contentIndexer,
    blobCache,
    rememberMe,
    remembered,
    services,
    startupRefresh,
    teardown,
  };
}

export function stopApp<S>(
  running: RunningApp<S>,
  options: { readonly clearBlobCache: boolean },
): Promise<void> {
  return running.teardown(options.clearBlobCache);
}
