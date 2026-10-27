import type { AutoRefresh } from "../app/auto-refresh";
import type { RunningApp } from "../app/start-app";
import {
  isRemoteChangeNotice,
  type RemoteChangeNotice,
  type SyncEngine,
  type SyncEngineState,
  type SyncError,
} from "../sync/sync-engine";
import {
  autoRefreshFailureReport,
  INITIAL_AUTO_REFRESH_FAILURE_STATE,
  manualRefreshFailureState,
  type AutoRefreshFailureState,
} from "../ui/browse/auto-refresh-failure-report";
import { describeSyncError } from "../ui/browse/sync-messages";
import { remoteChangeMessage } from "../ui/browse/status-announcer";
import {
  describeNotice,
  isPersistentToast,
  noticeTone,
} from "../ui/notices/notice-messages";
import type { AppSession } from "./app-session";
import type { CoreEvents } from "./api";
import type { EmitCoreEvent } from "./commands/command-context";
import { toCoreError } from "./core-errors";
import { toOpenNote } from "./open-note-view";
import { toTreeNodes } from "./tree-view";

export const REFRESH_NOTICE_ID = "refresh";
export const REFRESH_REJECTED_MESSAGE = "Refresh failed. Try again later.";

const REMOTE_CHANGES: Record<
  RemoteChangeNotice["kind"],
  CoreEvents["noteContentChangedRemotely"]["change"]
> = {
  "remote-updated": "updated",
  "remote-relocated": "relocated",
  "remote-trashed": "trashed",
};

export interface EngineEvents {
  attach(app: RunningApp): void;
  refreshSucceeded(): void;
  refreshFailed(error: SyncError | null): void;
  clearRefreshNotice(): void;
  dispose(): void;
}

export function createEngineEvents(options: {
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
}): EngineEvents {
  const { app, emit } = options;

  let hooked: AutoRefresh | null = null;
  let unhook: (() => void) | null = null;
  let activeEngine: SyncEngine | null = null;
  let failureReport: AutoRefreshFailureState = INITIAL_AUTO_REFRESH_FAILURE_STATE;
  let refreshNoticeShown = false;

  let tree: SyncEngineState["workingTree"] = null;
  let note = "null";
  let syncState: string | null = null;
  let seenNotices = new Set<number>();

  function reset(): void {
    unhook?.();
    unhook = null;
    hooked = null;
    activeEngine = null;
    failureReport = INITIAL_AUTO_REFRESH_FAILURE_STATE;
    refreshNoticeShown = false;
    tree = null;
    note = "null";
    syncState = null;
    seenNotices = new Set();
  }

  function showRefreshError(text: string): void {
    if (activeEngine?.getState().workingTree == null) return;
    refreshNoticeShown = true;
    emit("notice", {
      id: REFRESH_NOTICE_ID,
      tone: "error",
      message: text,
      persistent: isPersistentToast("error", false),
    });
  }

  function clearRefreshNotice(): void {
    if (!refreshNoticeShown) return;
    refreshNoticeShown = false;
    emit("noticeCleared", { id: REFRESH_NOTICE_ID });
  }

  function attach(running: RunningApp): void {
    activeEngine = running.engine;
    if (hooked === running.autoRefresh) return;
    unhook?.();
    hooked = running.autoRefresh;
    unhook = running.autoRefresh.onRefreshed((error) => {
      const { state, action } = autoRefreshFailureReport(failureReport, {
        error,
        online: running.engine.getState().online,
      });
      failureReport = state;
      if (action.kind === "show") {
        showRefreshError(describeSyncError(action.error, app.activeForgeName()));
      } else if (action.kind === "clear") {
        clearRefreshNotice();
      }
    });
  }

  function onState(engine: SyncEngine): void {
    const state = engine.getState();
    const forgeName = app.activeForgeName();

    if (state.workingTree !== tree) {
      tree = state.workingTree;
      emit("treeChanged", { tree: toTreeNodes(tree) });
    }

    const view = toOpenNote(state.openNote, forgeName);
    const viewKey = JSON.stringify(view);
    if (viewKey !== note) {
      note = viewKey;
      emit("noteChanged", { note: view });
    }

    const remote: RemoteChangeNotice[] = [];
    const present = new Set<number>();
    for (const notice of state.notices) {
      present.add(notice.id);
      if (seenNotices.has(notice.id)) continue;
      seenNotices.add(notice.id);
      if (isRemoteChangeNotice(notice)) {
        remote.push(notice);
        emit("noteContentChangedRemotely", {
          change: REMOTE_CHANGES[notice.kind],
          message: remoteChangeMessage(notice.kind),
        });
      } else {
        const tone = noticeTone(notice);
        emit("notice", {
          id: `engine-${notice.id}`,
          tone,
          message: describeNotice(notice),
          persistent: isPersistentToast(tone, false),
        });
      }
    }
    seenNotices = new Set([...seenNotices].filter((id) => present.has(id)));

    const lastRefreshError =
      state.refresh.lastError === null
        ? null
        : toCoreError(state.refresh.lastError, { source: "sync", forgeName });
    const sync: CoreEvents["syncStateChanged"] = {
      online: state.online,
      refreshing: state.refresh.inFlight,
      treeLoaded: state.workingTree !== null,
      lastRefreshError,
    };
    const syncKey = JSON.stringify(sync);
    if (syncKey !== syncState) {
      syncState = syncKey;
      emit("syncStateChanged", sync);
    }

    for (const notice of remote) engine.dismissNotice(notice.id);
  }

  const stopListening = app.onEngineState((engine) => {
    const running = app.current();
    if (engine === null) {
      reset();
      return;
    }
    if (activeEngine !== null && activeEngine !== engine) reset();
    activeEngine = engine;
    if (running !== null && running.engine === engine) attach(running);
    onState(engine);
  });

  return {
    attach,
    refreshSucceeded() {
      failureReport = INITIAL_AUTO_REFRESH_FAILURE_STATE;
      clearRefreshNotice();
    },
    refreshFailed(error) {
      if (error === null) {
        showRefreshError(REFRESH_REJECTED_MESSAGE);
        return;
      }
      failureReport = manualRefreshFailureState(error);
      showRefreshError(describeSyncError(error, app.activeForgeName()));
    },
    clearRefreshNotice,
    dispose() {
      stopListening();
      reset();
    },
  };
}
