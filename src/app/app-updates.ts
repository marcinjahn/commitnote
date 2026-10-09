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
  reload(): void;
}

export interface AppUpdates {
  readonly updateWaiting: boolean;
  subscribe(listener: (updateWaiting: boolean) => void): () => void;
  checkForUpdate(): void;
  skipWaiting(): void;
  attachGate(gate: { controllerChanged(): void }): () => void;
}

export function startAppUpdates(deps: AppUpdatesDeps): AppUpdates {
  const { container, clock } = deps;
  const listeners = new Set<(updateWaiting: boolean) => void>();
  let registration: RegistrationLike | null = null;
  let updateWaiting = false;
  let lastCheckAt = 0;
  let gate: { controllerChanged(): void } | null = null;
  let reloaded = false;

  function runUpdate(current: RegistrationLike): void {
    lastCheckAt = clock.now();
    current.update().catch(() => undefined);
  }

  function recompute(): void {
    const next =
      registration !== null &&
      registration.waiting !== null &&
      container.controller !== null;
    if (next === updateWaiting) return;
    updateWaiting = next;
    for (const listener of [...listeners]) listener(next);
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
    if (gate !== null) {
      gate.controllerChanged();
      return;
    }
    if (reloaded) return;
    reloaded = true;
    deps.reload();
  });

  return {
    get updateWaiting() {
      return updateWaiting;
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
    attachGate(next) {
      gate = next;
      return () => {
        if (gate === next) gate = null;
      };
    },
  };
}

export function startBrowserAppUpdates(): AppUpdates | null {
  if (!("serviceWorker" in navigator)) return null;
  return startAppUpdates({
    container: navigator.serviceWorker,
    scriptUrl: "./sw.js",
    clock: systemClock,
    reload: () => location.reload(),
  });
}
