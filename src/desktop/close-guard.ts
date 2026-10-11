export const CLOSE_GUARD_TIMEOUT_MS = 10_000;

export interface CloseGuardDeps {
  hasUnsaved(): boolean;
  flush(): void;
  onUnsavedChange(listener: () => void): () => void;
  hasSettledUnsaved(): boolean;
  confirmQuit(): Promise<boolean>;
  destroy(): void;
  timeoutMs?: number;
  setTimer?: (run: () => void, ms: number) => () => void;
}

export interface CloseGuard {
  requestClose(): Promise<void>;
  dispose(): void;
}

type WaitOutcome = "clean" | "unsaved" | "disposed";

function defaultSetTimer(run: () => void, ms: number): () => void {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
}

export function createCloseGuard(deps: CloseGuardDeps): CloseGuard {
  const timeoutMs = deps.timeoutMs ?? CLOSE_GUARD_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? defaultSetTimer;
  let disposed = false;
  let destroyed = false;
  let inFlight: Promise<void> | null = null;
  let endWait: ((outcome: WaitOutcome) => void) | null = null;

  function destroy() {
    if (disposed || destroyed) return;
    destroyed = true;
    deps.destroy();
  }

  function waitForSave(): Promise<WaitOutcome> {
    return new Promise((resolve) => {
      let unsubscribe: (() => void) | null = null;
      let clearTimer: (() => void) | null = null;
      let done = false;

      function finish(outcome: WaitOutcome) {
        if (done) return;
        done = true;
        endWait = null;
        unsubscribe?.();
        clearTimer?.();
        resolve(outcome);
      }

      function check() {
        if (!deps.hasUnsaved()) finish("clean");
        else if (deps.hasSettledUnsaved()) finish("unsaved");
      }

      endWait = finish;
      check();
      if (done) return;
      unsubscribe = deps.onUnsavedChange(check);
      if (done) {
        unsubscribe();
        return;
      }
      clearTimer = setTimer(() => finish("unsaved"), timeoutMs);
      if (done) clearTimer();
    });
  }

  async function run() {
    if (!deps.hasUnsaved()) {
      destroy();
      return;
    }
    deps.flush();
    const outcome = await waitForSave();
    if (disposed || outcome === "disposed") return;
    if (outcome === "clean") {
      destroy();
      return;
    }
    const quit = await deps.confirmQuit();
    if (quit) destroy();
  }

  return {
    requestClose() {
      if (disposed || destroyed) return Promise.resolve();
      if (inFlight) return inFlight;
      inFlight = run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    dispose() {
      disposed = true;
      endWait?.("disposed");
    },
  };
}
