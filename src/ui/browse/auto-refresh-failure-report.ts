import type { SyncEngineState, SyncError } from "../../sync/sync-engine";

export interface AutoRefreshFailureState {
  readonly shownKind: SyncError["kind"] | null;
  readonly transientFailures: number;
}

export const INITIAL_AUTO_REFRESH_FAILURE_STATE: AutoRefreshFailureState = {
  shownKind: null,
  transientFailures: 0,
};

export function manualRefreshFailureState(
  error: SyncError,
): AutoRefreshFailureState {
  return { shownKind: error.kind, transientFailures: 0 };
}

export type AutoRefreshFailureAction =
  | { readonly kind: "show"; readonly error: SyncError }
  | { readonly kind: "clear" }
  | { readonly kind: "none" };

export function autoRefreshFailureReport(
  state: AutoRefreshFailureState,
  input: { readonly error: SyncError | null; readonly online: boolean },
): { state: AutoRefreshFailureState; action: AutoRefreshFailureAction } {
  const { error, online } = input;
  if (error === null) {
    return {
      state: INITIAL_AUTO_REFRESH_FAILURE_STATE,
      action: state.shownKind !== null ? { kind: "clear" } : { kind: "none" },
    };
  }
  if (!online) return { state, action: { kind: "none" } };

  const transient = error.kind === "network" || error.kind === "server";
  const transientFailures = transient ? state.transientFailures + 1 : 0;
  if (transientFailures === 1) {
    return { state: { ...state, transientFailures }, action: { kind: "none" } };
  }
  if (error.kind === state.shownKind) {
    return { state: { ...state, transientFailures }, action: { kind: "none" } };
  }
  return {
    state: { shownKind: error.kind, transientFailures },
    action: { kind: "show", error },
  };
}

/**
 * The background refresh after starting from cached notes reports a failure
 * at once, since the notes shown may be out of date. Offline is already shown.
 */
export function startupRefreshFailureReport(
  engineState: Pick<SyncEngineState, "refresh" | "online">,
): { state: AutoRefreshFailureState; action: AutoRefreshFailureAction } {
  const error = engineState.refresh.lastError;
  const { online } = engineState;
  if (error === null || !online) {
    return {
      state: INITIAL_AUTO_REFRESH_FAILURE_STATE,
      action: { kind: "none" },
    };
  }
  return {
    state: manualRefreshFailureState(error),
    action: { kind: "show", error },
  };
}
