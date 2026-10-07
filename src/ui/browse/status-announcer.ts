import type { SyncEngineState } from "../../sync/sync-engine";
import type { SyncState } from "../../sync/sync-state";
import { describeOffline, describeSyncState } from "./sync-messages";

export const ALL_CHANGES_SAVED = "All changes saved";

export type SyncProblem = "offline" | "failed" | null;

export interface AnnouncerState {
  problem: SyncProblem;
  awaitingRecovery: boolean;
}

export const INITIAL_ANNOUNCER_STATE: AnnouncerState = {
  problem: null,
  awaitingRecovery: false,
};

export function syncProblem(input: {
  online: boolean;
  root: SyncState;
  save: SyncEngineState["save"];
}): SyncProblem {
  if (!input.online) return "offline";
  const rootFailed =
    input.root.kind === "out-of-sync" && input.root.reason === "failed";
  const saveFailed =
    input.save.kind === "waiting" && input.save.reason === "failed";
  return rootFailed || saveFailed ? "failed" : null;
}

export function nextAnnouncement(
  state: AnnouncerState,
  input: { problem: SyncProblem; allSaved: boolean; hasUnsaved: boolean },
): { state: AnnouncerState; message: string | null } {
  const { problem } = input;
  if (problem !== null) {
    if (problem === state.problem) return { state, message: null };
    const message =
      problem === "offline"
        ? describeOffline(input.hasUnsaved)
        : describeSyncState({ kind: "out-of-sync", reason: "failed" });
    return { state: { problem, awaitingRecovery: true }, message };
  }
  if (state.awaitingRecovery && input.allSaved) {
    return {
      state: { problem: null, awaitingRecovery: false },
      message: ALL_CHANGES_SAVED,
    };
  }
  return { state: { ...state, problem: null }, message: null };
}
