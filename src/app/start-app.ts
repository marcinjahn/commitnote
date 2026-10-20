import type { BlobCache } from "../blob-cache/blob-cache";
import { withBlobCache } from "../blob-cache/caching-adapter";
import type { ForgeAdapter } from "../forge/forge-adapter";
import type { ForgeId } from "../forge/repo-coordinates";
import {
  createContentIndexer,
  type ContentIndexer,
} from "../search/content-indexer";
import { createIndexerEnvironment } from "../search/indexer-environment";
import type { SessionStore } from "../session/session-store";
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
  hasUnsaved(): boolean;
  hasSettledUnsaved(): boolean;
  flush(): void;
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
  readonly teardown: (clearBlobCache: boolean) => Promise<void>;
}

export async function startApp<S>(
  deps: StartAppDeps<S>,
  input: StartAppInput,
): Promise<RunningApp<S>> {
  const { store, ports, clock } = deps;
  const { session, adapter, rememberMe } = input;

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
    deps.afterStart?.({
      engine,
      settingsSaver,
      hasUnsaved,
      flush,
      onUnsavedChange,
      hasSettledUnsaved: () => {
        const state = engine.getState();
        return (
          state.save.kind === "waiting" ||
          state.conflicts.length > 0 ||
          state.stopped !== null ||
          !state.online
        );
      },
    }) ?? null;

  // Forge errors resolve with `refresh.lastError` set, which the shell shows.
  let refreshed = true;
  try {
    await engine.refresh({ knownHead: input.knownHead });
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

  if (refreshed) {
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
  }

  const teardown = (clearBlobCache: boolean): Promise<void> => {
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
    teardown,
  };
}

export function stopApp<S>(
  running: RunningApp<S>,
  options: { readonly clearBlobCache: boolean },
): Promise<void> {
  return running.teardown(options.clearBlobCache);
}
