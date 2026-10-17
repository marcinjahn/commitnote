export interface UpdateGateDeps {
  hasUnsaved(): boolean;
  flush(): void;
  onUnsavedChange(listener: () => void): () => void;
  skipWaiting(): void;
  reload(): void;
}

export type UpdateGateState =
  | "idle"
  | "waitingForSave"
  | "activating"
  | "reloadPending"
  | "reloading";

export interface UpdateGate {
  readonly state: UpdateGateState;
  accept(): void;
  controllerChanged(): void;
  reloadWhenClean(): void;
  subscribe(listener: (state: UpdateGateState) => void): () => void;
  dispose(): void;
}

export function createUpdateGate(deps: UpdateGateDeps): UpdateGate {
  let state: UpdateGateState = "idle";
  let disposed = false;
  let unsubscribeUnsaved: (() => void) | null = null;
  const listeners = new Set<(state: UpdateGateState) => void>();

  function stopWatching() {
    unsubscribeUnsaved?.();
    unsubscribeUnsaved = null;
  }

  function setState(next: UpdateGateState) {
    if (next === state) return;
    state = next;
    const watching = next === "waitingForSave" || next === "reloadPending";
    if (!watching) stopWatching();
    else if (!unsubscribeUnsaved) unsubscribeUnsaved = deps.onUnsavedChange(onUnsavedChange);
    for (const listener of [...listeners]) listener(next);
  }

  function activate() {
    setState("activating");
    if (!disposed) deps.skipWaiting();
  }

  function reload() {
    setState("reloading");
    if (!disposed) deps.reload();
  }

  function onUnsavedChange() {
    if (disposed || deps.hasUnsaved()) return;
    if (state === "waitingForSave") activate();
    else if (state === "reloadPending") reload();
  }

  return {
    get state() {
      return state;
    },
    accept() {
      if (disposed) return;
      if (state === "activating" || state === "reloadPending" || state === "reloading") return;
      deps.flush();
      if (deps.hasUnsaved()) setState("waitingForSave");
      else activate();
    },
    controllerChanged() {
      if (disposed || state === "reloading") return;
      if (!deps.hasUnsaved()) {
        reload();
        return;
      }
      deps.flush();
      setState("reloadPending");
    },
    reloadWhenClean() {
      if (disposed || state !== "reloadPending") return;
      deps.flush();
      if (!deps.hasUnsaved()) reload();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      stopWatching();
      listeners.clear();
    },
  };
}
