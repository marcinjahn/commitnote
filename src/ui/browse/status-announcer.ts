import {
  isRemoteChangeNotice,
  type EngineNotice,
  type RemoteChangeNotice,
  type SyncEngineState,
} from "../../sync/sync-engine";
import type { SyncState } from "../../sync/sync-state";
import { describeOffline, describeSyncState } from "./sync-messages";

export const ALL_CHANGES_SAVED = "All changes saved";

export type SyncProblem = "offline" | "failed" | null;

export interface AnnouncerState {
  problem: SyncProblem;
  awaitingRecovery: boolean;
  announcedNoticeId: number;
}

export const INITIAL_ANNOUNCER_STATE: AnnouncerState = {
  problem: null,
  awaitingRecovery: false,
  announcedNoticeId: -1,
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

export function remoteChangeMessage(
  kind: RemoteChangeNotice["kind"],
): string {
  switch (kind) {
    case "remote-updated":
      return "Updated on another device.";
  }
}

export function nextAnnouncement(
  state: AnnouncerState,
  input: {
    problem: SyncProblem;
    allSaved: boolean;
    hasUnsaved: boolean;
    notices: readonly EngineNotice[];
  },
): { state: AnnouncerState; message: string | null } {
  const { problem } = input;
  const fresh = input.notices
    .filter(isRemoteChangeNotice)
    .filter((notice) => notice.id > state.announcedNoticeId);
  const newest = fresh.reduce<RemoteChangeNotice | null>(
    (best, notice) => (best === null || notice.id > best.id ? notice : best),
    null,
  );
  const announcedNoticeId = newest?.id ?? state.announcedNoticeId;
  const remoteMessage =
    newest === null ? null : remoteChangeMessage(newest.kind);

  if (problem !== null) {
    if (problem === state.problem) {
      return { state: { ...state, announcedNoticeId }, message: null };
    }
    const message =
      problem === "offline"
        ? describeOffline(input.hasUnsaved)
        : describeSyncState({ kind: "out-of-sync", reason: "failed" });
    return {
      state: { problem, awaitingRecovery: true, announcedNoticeId },
      message,
    };
  }
  if (state.awaitingRecovery && input.allSaved) {
    return {
      state: { problem: null, awaitingRecovery: false, announcedNoticeId },
      message: ALL_CHANGES_SAVED,
    };
  }
  return {
    state: { ...state, problem: null, announcedNoticeId },
    message: remoteMessage,
  };
}
