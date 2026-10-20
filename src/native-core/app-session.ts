import type { BlobStoreProvider } from "../app/blob-cache-lifecycle";
import type { PlatformPorts } from "../app/platform-ports";
import {
  startApp,
  stopApp,
  type RunningApp,
  type StartAppDeps,
} from "../app/start-app";
import type { ForgeAdapter } from "../forge/forge-adapter";
import {
  adapterFactoryFor,
  type ForgeAdapterFactory,
  type ForgeRegistry,
} from "../forge/registry";
import type { ForgeId } from "../forge/repo-coordinates";
import type { LoginDependencies } from "../login/login";
import type { SessionStore } from "../session/session-store";
import type { Session } from "../session/session";
import type { DeviceSettingsStore } from "../settings/device-settings-store";
import { shareLinkBase } from "../share/share-link";
import type { Clock } from "../sync/clock";
import { createRateBudget, type RateBudget } from "../sync/rate-budget";
import type { SyncEngine } from "../sync/sync-engine";
import {
  describeKeyChangedUnsaved,
  KEY_CHANGED_MESSAGE,
} from "../ui/browse/sync-messages";
import { exportNotesLabel } from "../ui/session/session-messages";
import type { EmitCoreEvent } from "./commands/command-context";
import { createHostBlobStore } from "./host-blob-store";
import {
  createHostDeviceSettingsStore,
  nativeDeviceName,
} from "./host-device-settings";
import { createHostSessionStore } from "./host-session-store";
import type { HostServices } from "./host-services";
import { createNativeLifecycle } from "./native-lifecycle";
import { hostArgon2id } from "./runtime/host-argon2";

export interface AppSession {
  readonly store: SessionStore;
  readonly ports: PlatformPorts;
  readonly blobStore: BlobStoreProvider;
  deviceName(): string;
  registry(): Promise<ForgeRegistry>;
  forgeName(forge: ForgeId): Promise<string>;
  activeForgeName(): string;
  loginDeps(): Promise<LoginDependencies>;
  start(input: {
    readonly session: Session;
    readonly adapter: ForgeAdapter;
    readonly resumed: boolean;
    readonly knownHead?: string;
  }): Promise<void>;
  stop(options: { readonly clearBlobCache: boolean }): Promise<void>;
  current(): RunningApp | null;
  onEngineState(listener: (engine: SyncEngine | null) => void): () => void;
  setVisible(visible: boolean): void;
  setOnline(online: boolean): void;
  dispose(): Promise<void>;
}

function hostClockAsClock(host: HostServices): Clock {
  return {
    now: () => host.clock.now(),
    setTimeout: (callback, ms) => host.clock.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      if (typeof handle === "number") host.clock.clearTimeout(handle);
    },
  };
}

function hostBlobStoreProvider(host: HostServices): BlobStoreProvider {
  return {
    open: () => createHostBlobStore(host),
    async deleteAll() {
      try {
        for (const repoKey of await host.blobCache.listRepos()) {
          await host.blobCache.deleteRepo(repoKey);
        }
      } catch {
        // An unavailable cache has nothing to delete.
      }
    },
  };
}

export function createAppSession(options: {
  readonly host: HostServices;
  readonly deviceModel: string;
  readonly registry: () => Promise<ForgeRegistry>;
  readonly emit: EmitCoreEvent;
}): AppSession {
  const { host, emit } = options;
  const clock = hostClockAsClock(host);
  const store = createHostSessionStore(host);
  const blobStore = hostBlobStoreProvider(host);
  const deviceSettings: DeviceSettingsStore =
    createHostDeviceSettingsStore(host);
  const lifecycle = createNativeLifecycle();
  const ports: PlatformPorts = {
    connectivity: lifecycle.connectivity,
    visibility: lifecycle.visibility,
    persistentStorage: null,
    navigation: {
      shareLinkBase: () => shareLinkBase({ origin: "", pathname: "" }, true),
      clearNoteFragment: () => undefined,
    },
  };

  const rateBudgets = new Map<ForgeId, RateBudget>();
  function rateBudgetFor(forge: ForgeId, adapter: ForgeAdapter): RateBudget {
    let budget = rateBudgets.get(forge);
    if (budget === undefined) {
      budget = createRateBudget(clock, adapter.limits);
      rateBudgets.set(forge, budget);
    }
    return budget;
  }

  const deviceName = () =>
    nativeDeviceName(deviceSettings, options.deviceModel);

  let registryLoading: Promise<ForgeRegistry> | null = null;
  let loadedRegistry: ForgeRegistry | null = null;
  function registry(): Promise<ForgeRegistry> {
    registryLoading ??= options
      .registry()
      .then((resolved) => {
        loadedRegistry = resolved;
        return resolved;
      })
      .catch((error: unknown) => {
        registryLoading = null;
        throw error;
      });
    return registryLoading;
  }

  async function loginDeps(): Promise<LoginDependencies> {
    const resolved = await registry();
    const createAdapter: ForgeAdapterFactory = (
      coordinates,
      adapterOptions,
    ) => {
      const adapter = adapterFactoryFor(resolved)(coordinates, {
        ...adapterOptions,
        onContentCreatingRequest: (request) => {
          rateBudgetFor(coordinates.forge, adapter).record();
          adapterOptions.onContentCreatingRequest?.(request);
        },
      });
      return adapter;
    };
    return {
      createAdapter,
      argon2id: hostArgon2id(host.crypto),
      deviceName,
    };
  }

  let running: RunningApp | null = null;
  let activeForge: ForgeId | null = null;
  let disposed = false;
  let keyChanged: number | null = null;
  const engineListeners = new Set<(engine: SyncEngine | null) => void>();

  function notifyEngine(engine: SyncEngine | null): void {
    for (const listener of [...engineListeners]) listener(engine);
  }

  const deps: StartAppDeps = {
    store,
    ports,
    clock,
    rateBudgetFor,
    deviceName,
    requestPersistentStorageOnResume: false,
    blobStore,
    installLifecycle: (handlers) => lifecycle.install(handlers),
    afterStart({ engine }) {
      const unsubscribe = engine.subscribe(() => notifyEngine(engine));
      return () => {
        unsubscribe();
        notifyEngine(null);
      };
    },
    onKeyChanged(state) {
      const unsavedCount = state?.unsavedCount ?? null;
      if (unsavedCount === keyChanged) return;
      keyChanged = unsavedCount;
      if (unsavedCount === null) return;
      emit("keyChanged", {
        unsavedCount,
        message: KEY_CHANGED_MESSAGE,
        detail: describeKeyChangedUnsaved(unsavedCount),
        exportLabel: exportNotesLabel(unsavedCount),
      });
    },
    onRefreshState: () => undefined,
  };

  async function stop(stopOptions: {
    readonly clearBlobCache: boolean;
  }): Promise<void> {
    const app = running;
    if (app === null) return;
    running = null;
    await stopApp(app, stopOptions);
  }

  return {
    store,
    ports,
    blobStore,
    deviceName,
    registry,
    async forgeName(forge) {
      return (await registry())[forge].name;
    },
    activeForgeName: () =>
      activeForge === null ? "" : (loadedRegistry?.[activeForge].name ?? ""),
    loginDeps,
    async start(input) {
      if (disposed) return;
      await stop({ clearBlobCache: false });
      activeForge = input.session.coordinates.forge;
      const app = await startApp(deps, {
        session: input.session,
        adapter: input.adapter,
        rememberMe: true,
        resumed: input.resumed,
        purgeBlobCache: false,
        ...(input.knownHead === undefined
          ? {}
          : { knownHead: input.knownHead }),
      });
      if (disposed) {
        await stopApp(app, { clearBlobCache: false });
        return;
      }
      running = app;
    },
    stop,
    current: () => running,
    onEngineState(listener) {
      engineListeners.add(listener);
      return () => engineListeners.delete(listener);
    },
    setVisible: (visible) => lifecycle.setVisible(visible),
    setOnline: (online) => lifecycle.setOnline(online),
    async dispose() {
      disposed = true;
      await stop({ clearBlobCache: false });
      deviceSettings.dispose();
    },
  };
}
