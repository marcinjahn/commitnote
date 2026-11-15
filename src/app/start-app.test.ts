import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { repoKeyOf } from "../blob-cache/blob-cache";
import { cachedTreeStorageKey } from "../blob-cache/cached-tree";
import { createMemoryBlobStoreProvider } from "../blob-cache/testing/memory-blob-store";
import { createRepoConfig, type Keyring } from "../crypto/keyring";
import { sharedMemoizedArgon2id } from "../crypto/testing/shared-argon2id";
import { ForgeError } from "../forge/errors";
import { delegateAdapter } from "../forge/fake/delegating-adapter";
import type { ForgeAdapter } from "../forge/forge-adapter";
import type { RepoCoordinates } from "../forge/repo-coordinates";
import type { SessionStore, StorageLike } from "../session/session-store";
import type { Session } from "../session/session";
import { createRateBudget } from "../sync/rate-budget";
import type { SyncError } from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import { CACHED_TREE_SAVE_DELAY_MS } from "../sync/tuning";
import {
  sampleNotesRepoConfig,
  sampleNotesRepoKeyring,
} from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSampleNotesRepoAdapter } from "../testing/sample-notes-repo/seed-sample-notes-repo";
import type { PlatformPorts } from "./platform-ports";
import {
  startApp,
  startAppFromCache,
  stopApp,
  type StartAppDeps,
  type StartAppInput,
} from "./start-app";

const COORDINATES: RepoCoordinates = {
  forge: "github",
  owner: "alice",
  repo: "notes",
};

let keyring: Keyring;
let otherKeyring: Keyring;

beforeAll(async () => {
  keyring = await sampleNotesRepoKeyring();
  otherKeyring = (
    await createRepoConfig("unrelated", {
      argon2id: sharedMemoizedArgon2id,
      kdf: sampleNotesRepoConfig().kdf,
    })
  ).keyring;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sessionWith(sessionKeyring: Keyring): Session {
  return {
    repoUrl: "https://github.com/alice/notes",
    coordinates: COORDINATES,
    accessToken: "token",
    keyring: sessionKeyring,
  };
}

function createMemorySessionStore(): SessionStore {
  let remembered: Session | null = null;
  return {
    start(session, { rememberMe }) {
      remembered = rememberMe ? session : null;
      return Promise.resolve({ remembered: rememberMe });
    },
    loadRememberedSession: () => Promise.resolve(remembered),
    clear() {
      remembered = null;
      return Promise.resolve();
    },
    lastRepoUrl: () => null,
    lastForgeId: () => null,
  };
}

function createFakePorts(): PlatformPorts & {
  readonly persistRequests: number;
} {
  let persistRequests = 0;
  return {
    connectivity: { isOnline: () => true, subscribe: () => () => undefined },
    visibility: { isVisible: () => true, subscribe: () => () => undefined },
    persistentStorage: {
      request() {
        persistRequests++;
        return Promise.resolve();
      },
    },
    navigation: {
      shareLinkBase: () => "https://example.test/",
      clearNoteFragment: () => undefined,
    },
    get persistRequests() {
      return persistRequests;
    },
  };
}

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createHarness() {
  const clock = createTestClock(1_000_000);
  const blobStore = createMemoryBlobStoreProvider();
  const refreshStates: { lastError: SyncError | null; treeLoaded: boolean }[] =
    [];
  const keyChanges: ({ readonly unsavedCount: number } | null)[] = [];
  const uninstallLifecycle = vi.fn();
  const disposeAfterStart = vi.fn();
  const disposeServices = vi.fn();
  const deviceStorage = new MemoryStorage();
  const deps: StartAppDeps<{ readonly label: string }> = {
    store: createMemorySessionStore(),
    ports: createFakePorts(),
    clock,
    rateBudgetFor: (_forge, adapter) => createRateBudget(clock, adapter.limits),
    deviceName: () => "Test device",
    requestPersistentStorageOnResume: false,
    blobStore,
    deviceStorage,
    installLifecycle: () => uninstallLifecycle,
    createServices: () => ({ label: "services" }),
    disposeServices,
    afterStart: () => disposeAfterStart,
    onKeyChanged: (state) => keyChanges.push(state),
    onRefreshState: (state) => refreshStates.push(state),
  };
  return {
    deps,
    clock,
    deviceStorage,
    blobStore,
    refreshStates,
    keyChanges,
    uninstallLifecycle,
    disposeAfterStart,
    disposeServices,
  };
}

async function inputFor(
  overrides: Partial<StartAppInput> & { readonly adapter?: ForgeAdapter } = {},
): Promise<StartAppInput> {
  return {
    session: sessionWith(keyring),
    adapter: await createSampleNotesRepoAdapter(),
    rememberMe: true,
    resumed: false,
    purgeBlobCache: false,
    ...overrides,
  };
}

describe("startApp", () => {
  it("refreshes on startup, reports the loaded tree and builds the services", async () => {
    const h = createHarness();

    const running = await startApp(h.deps, await inputFor());

    expect(running.engine.getState().workingTree).not.toBeNull();
    expect(h.refreshStates.at(-1)).toEqual({
      lastError: null,
      treeLoaded: true,
    });
    expect(h.keyChanges.at(-1)).toBeNull();
    expect(running.services).toEqual({ label: "services" });
    expect(running.remembered).toBe(true);
    await stopApp(running, { clearBlobCache: false });
  });

  it("runs housekeeping only after a successful startup refresh", async () => {
    const h = createHarness();
    const fake = await createSampleNotesRepoAdapter();
    const sweepAbandoned = vi.fn(() => Promise.resolve());

    const running = await startApp(
      h.deps,
      await inputFor({ adapter: delegateAdapter(fake, { sweepAbandoned }) }),
    );
    expect(sweepAbandoned).toHaveBeenCalledOnce();
    await stopApp(running, { clearBlobCache: false });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingSweep = vi.fn(() => Promise.resolve());
    const failing = await startApp(
      h.deps,
      await inputFor({
        adapter: delegateAdapter(fake, {
          sweepAbandoned: failingSweep,
          getHead: () => Promise.reject(new Error("unexpected")),
        }),
      }),
    );
    expect(failingSweep).not.toHaveBeenCalled();
    await stopApp(failing, { clearBlobCache: false });
  });

  it("reports a key change when the engine stops for one", async () => {
    const h = createHarness();

    const running = await startApp(
      h.deps,
      await inputFor({ session: sessionWith(otherKeyring) }),
    );

    expect(running.engine.getState().stopped).toEqual({ kind: "keyChanged" });
    expect(h.keyChanges.at(-1)).toEqual({ unsavedCount: 0 });
    await stopApp(running, { clearBlobCache: false });
    expect(h.keyChanges.at(-1)).toBeNull();
  });

  it("tears everything down and keeps the injected blob cache unless asked to clear it", async () => {
    const h = createHarness();
    const repoKey = repoKeyOf(COORDINATES);
    const cachedEntries = () =>
      [...h.blobStore.entries.keys()].filter((key) =>
        key.startsWith(`${repoKey}\u0000`),
      ).length;

    const kept = await startApp(h.deps, await inputFor());
    expect(h.blobStore.opened).toBe(1);
    await stopApp(kept, { clearBlobCache: false });

    expect(h.uninstallLifecycle).toHaveBeenCalledOnce();
    expect(h.disposeAfterStart).toHaveBeenCalledOnce();
    expect(h.disposeServices).toHaveBeenCalledExactlyOnceWith({
      label: "services",
    });
    expect(h.refreshStates.at(-1)).toEqual({
      lastError: null,
      treeLoaded: false,
    });
    const reportsAfterStop = h.refreshStates.length;
    await kept.engine.refresh();
    expect(h.refreshStates).toHaveLength(reportsAfterStop);
    expect(cachedEntries()).toBeGreaterThan(0);

    const cleared = await startApp(h.deps, await inputFor());
    await stopApp(cleared, { clearBlobCache: true });
    expect(cachedEntries()).toBe(0);
  });

  it("deletes the injected blob store and runs without a cache for a session that is not remembered", async () => {
    const h = createHarness();

    const running = await startApp(
      h.deps,
      await inputFor({ rememberMe: false }),
    );

    expect(running.blobCache).toBeNull();
    expect(h.blobStore.opened).toBe(0);
    expect(h.blobStore.deletedAll).toBe(1);
    await stopApp(running, { clearBlobCache: false });
  });
});

describe("startAppFromCache", () => {
  async function startedOnce(h: ReturnType<typeof createHarness>) {
    const fake = await createSampleNotesRepoAdapter();
    const running = await startApp(h.deps, await inputFor({ adapter: fake }));
    h.clock.advance(CACHED_TREE_SAVE_DELAY_MS);
    await vi.waitFor(() => {
      expect(
        h.deviceStorage.getItem(cachedTreeStorageKey(repoKeyOf(COORDINATES))),
      ).not.toBeNull();
    });
    await stopApp(running, { clearBlobCache: false });
    return fake;
  }

  it("starts nothing without a cached tree", async () => {
    const h = createHarness();
    const getHead = vi.fn(() => Promise.resolve("unused"));
    const fake = await createSampleNotesRepoAdapter();

    const running = await startAppFromCache(h.deps, {
      session: sessionWith(keyring),
      adapter: delegateAdapter(fake, { getHead }),
      purgeBlobCache: false,
    });

    expect(running).toBeNull();
    expect(getHead).not.toHaveBeenCalled();
  });

  it("shows the cached tree before the forge answers, then refreshes and runs housekeeping", async () => {
    const h = createHarness();
    const fake = await startedOnce(h);
    let releaseHead = () => undefined as void;
    const headHeld = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    const sweepAbandoned = vi.fn(() => Promise.resolve());
    const adapter = delegateAdapter(fake, {
      getHead: async () => {
        await headHeld;
        return fake.getHead();
      },
      sweepAbandoned,
    });

    const running = await startAppFromCache(h.deps, {
      session: sessionWith(keyring),
      adapter,
      purgeBlobCache: false,
    });

    expect(running?.engine.getState().workingTree).not.toBeNull();
    expect(running?.startupRefresh).not.toBeNull();
    expect(sweepAbandoned).not.toHaveBeenCalled();

    releaseHead();
    await running?.startupRefresh;
    expect(running?.engine.getState().refresh.lastError).toBeNull();
    expect(sweepAbandoned).toHaveBeenCalledOnce();
    await stopApp(running!, { clearBlobCache: false });
  });

  it("keeps the cached tree and skips housekeeping when the background refresh fails", async () => {
    const h = createHarness();
    const fake = await startedOnce(h);
    const sweepAbandoned = vi.fn(() => Promise.resolve());

    const running = await startAppFromCache(h.deps, {
      session: sessionWith(keyring),
      adapter: delegateAdapter(fake, {
        getHead: () => Promise.reject(new ForgeError("Network")),
        sweepAbandoned,
      }),
      purgeBlobCache: false,
    });
    await running?.startupRefresh;

    expect(running?.engine.getState().workingTree).not.toBeNull();
    expect(running?.engine.getState().refresh.lastError).not.toBeNull();
    expect(sweepAbandoned).not.toHaveBeenCalled();
    await stopApp(running!, { clearBlobCache: false });
  });
});
