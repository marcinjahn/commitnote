import { type Clock, systemClock } from "../sync/clock";

export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: () => void): void;
}

interface RegistrationLike {
  readonly active: unknown;
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: string, listener: () => void): void;
}

export interface AppUpdatesDeps {
  container: {
    register(
      scriptUrl: string,
      options: { updateViaCache: "none" },
    ): Promise<RegistrationLike | undefined>;
    readonly controller: unknown;
    addEventListener(type: string, listener: () => void): void;
  };
  scriptUrl: string;
  clock: Pick<Clock, "now">;
}

export interface AppUpdates {
  readonly updateWaiting: boolean;
  readonly controllerChanged: boolean;
  subscribe(listener: () => void): () => void;
  checkForUpdate(): void;
  skipWaiting(): void;
}

export function startAppUpdates(deps: AppUpdatesDeps): AppUpdates {
  const { container, clock } = deps;
  const listeners = new Set<() => void>();
  let registration: RegistrationLike | null = null;
  let updateWaiting = false;
  let controllerChanged = false;
  let lastCheckAt = 0;

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function runUpdate(current: RegistrationLike): void {
    lastCheckAt = clock.now();
    current.update().catch(() => undefined);
  }

  function hasWaitingUpdate(): boolean {
    return (
      registration !== null &&
      registration.waiting !== null &&
      container.controller !== null
    );
  }

  function recompute(): void {
    const next = hasWaitingUpdate();
    if (next === updateWaiting) return;
    updateWaiting = next;
    notify();
  }

  function onRegistered(current: RegistrationLike): void {
    registration = current;
    current.addEventListener("updatefound", () => {
      current.installing?.addEventListener("statechange", recompute);
      recompute();
    });
    if (current.active) runUpdate(current);
    else lastCheckAt = clock.now();
    recompute();
  }

  container.register(deps.scriptUrl, { updateViaCache: "none" }).then(
    (current) => {
      if (current) onRegistered(current);
    },
    () => undefined,
  );

  container.addEventListener("controllerchange", () => {
    controllerChanged = true;
    updateWaiting = hasWaitingUpdate();
    notify();
  });

  return {
    get updateWaiting() {
      return updateWaiting;
    },
    get controllerChanged() {
      return controllerChanged;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkForUpdate() {
      if (registration === null) return;
      if (clock.now() - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
      runUpdate(registration);
    },
    skipWaiting() {
      registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    },
  };
}

export function startBrowserAppUpdates(): AppUpdates | null {
  if (!("serviceWorker" in navigator)) return null;
  return startAppUpdates({
    container: navigator.serviceWorker,
    scriptUrl: "./sw.js",
    clock: systemClock,
  });
}
