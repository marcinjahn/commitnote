import type { AutoRefresh } from "../app/auto-refresh";
import { notePathEquals } from "../changes/change";
import { minimalChanges } from "../editor/minimal-changes";
import {
  isRemoteChangeNotice,
  type RemoteChangeNotice,
  type SyncEngine,
  type SyncEngineState,
  type SyncError,
} from "../sync/sync-engine";
import { listUnsavedNotes } from "../sync/unsaved-notes";
import {
  autoRefreshFailureReport,
  INITIAL_AUTO_REFRESH_FAILURE_STATE,
  manualRefreshFailureState,
  type AutoRefreshFailureState,
} from "../ui/browse/auto-refresh-failure-report";
import {
  describeSyncError,
  describeSyncState,
  describeSyncStatus,
} from "../ui/browse/sync-messages";
import { buildTagFilter, resolveTagFilter } from "../ui/browse/tag-filter";
import { COLOR_TAG_PALETTE, type ColorTag } from "../tags/color-tag";
import {
  DELETE_PERMANENTLY_MESSAGE,
  DELETE_PERMANENTLY_TITLE,
  describeEmptyTrash,
  EMPTY_TRASH_TITLE,
} from "../ui/trash/trash-messages";
import { buildSyncStatusMenu } from "../ui/browse/sync-status-menu";
import { remoteChangeMessage } from "../ui/browse/status-announcer";
import {
  describeNotice,
  isPersistentToast,
  noticeTone,
} from "../ui/notices/notice-messages";
import type { AppSession, NativeRunningApp } from "./app-session";
import type {
  CoreEvents,
  NoticeAction,
  OpenNote,
  RemoteTextEdit,
} from "./api";
import type { EmitCoreEvent } from "./commands/command-context";
import { toCoreError } from "./core-errors";
import { toOpenNote } from "./open-note-view";
import { buildSharesView } from "./share-view";
import { toTrashEntries } from "./trash-view";
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
  attach(app: NativeRunningApp): void;
  refreshSucceeded(): void;
  refreshFailed(error: SyncError | null): void;
  clearRefreshNotice(): void;
  noteSwitched(): void;
  updatingShare(): string | null;
  setUpdatingShare(id: string | null): void;
  setTagFilter(tag: ColorTag | null): void;
  clearTagFilter(): void;
  dispose(): void;
}

const OPEN_NOTE_LABEL = "Open note";

function syncStatePayload(
  state: SyncEngineState,
  lastRefreshError: CoreEvents["syncStateChanged"]["lastRefreshError"],
): CoreEvents["syncStateChanged"] {
  const { syncStates } = state;
  const syncState = syncStates.stateOf([]);
  const canRetry =
    state.online &&
    state.save.kind === "waiting" &&
    state.save.reason === "failed";
  const unsaved =
    state.workingTree === null
      ? { notes: [], others: syncStates.unsavedCount }
      : listUnsavedNotes({
          pending: state.pending,
          inFlight: state.inFlight,
          conflicts: state.conflicts.map((c) => c.path),
          tree: state.workingTree,
          unsavedCount: syncStates.unsavedCount,
        });
  const menu = buildSyncStatusMenu({ ...unsaved, canRetry });
  return {
    online: state.online,
    refreshing: state.refresh.inFlight,
    treeLoaded: state.workingTree !== null,
    lastRefreshError,
    state:
      syncState.kind === "out-of-sync"
        ? { kind: syncState.kind, reason: syncState.reason }
        : { kind: syncState.kind },
    label: describeSyncState(syncState),
    status:
      !state.online || syncState.kind === "out-of-sync"
        ? describeSyncStatus({
            state: syncState,
            offline: !state.online,
            hasUnsaved: syncStates.hasUnsaved,
            standalone: true,
          })
        : null,
    unsavedCount: syncStates.unsavedCount,
    canRetry,
    unsavedMenu: menu.items.map((item) => {
      const path = menu.pathOf(item.id);
      return { id: item.id, label: item.label, path: path && [...path] };
    }),
  };
}

function noticeAction(notice: SyncEngineState["notices"][number]): NoticeAction | null {
  return notice.kind === "conflict"
    ? { kind: "openNote", label: OPEN_NOTE_LABEL, path: [...notice.path] }
    : null;
}

function remoteEdits(
  previous: OpenNote | null,
  next: OpenNote | null,
  switched: boolean,
): RemoteTextEdit[] | null {
  if (previous?.state !== "loaded" || next?.state !== "loaded") return null;
  if (switched && !notePathEquals(previous.path, next.path)) return null;
  return keepSurrogatePairs(
    previous.content,
    next.content,
    minimalChanges(previous.content, next.content).map((change) => {
      const { from, to, insert } = change as {
        from: number;
        to?: number;
        insert?: string;
      };
      return { from, to: to ?? from, insert: insert ?? "" };
    }),
  );
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function keepSurrogatePairs(
  previous: string,
  next: string,
  edits: readonly RemoteTextEdit[],
): RemoteTextEdit[] {
  const widened: { from: number; to: number; newFrom: number; newTo: number }[] = [];
  let delta = 0;
  for (const edit of edits) {
    let from = edit.from;
    let to = edit.to;
    let newFrom = from + delta;
    let newTo = newFrom + edit.insert.length;
    delta += edit.insert.length - (to - from);
    if (from > 0 && isHighSurrogate(previous.charCodeAt(from - 1))) {
      from -= 1;
      newFrom -= 1;
    }
    if (to < previous.length && isLowSurrogate(previous.charCodeAt(to))) {
      to += 1;
      newTo += 1;
    }
    const last = widened[widened.length - 1];
    if (last && last.to >= from) {
      last.to = Math.max(last.to, to);
      last.newTo = newTo;
    } else {
      widened.push({ from, to, newFrom, newTo });
    }
  }
  return widened.map((edit) => ({
    from: edit.from,
    to: edit.to,
    insert: next.slice(edit.newFrom, edit.newTo),
  }));
}

export function createEngineEvents(options: {
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
  readonly now: () => number;
}): EngineEvents {
  const { app, emit, now } = options;

  let hooked: AutoRefresh | null = null;
  let unhook: (() => void) | null = null;
  let activeEngine: SyncEngine | null = null;
  let failureReport: AutoRefreshFailureState = INITIAL_AUTO_REFRESH_FAILURE_STATE;
  let refreshNoticeShown = false;

  let tree: SyncEngineState["workingTree"] = null;
  let tagFilter: ColorTag | null = null;
  let shownFilter: ColorTag | null = null;
  let tagsWritable = false;
  let trash = "null";
  let openPath = "null";
  let note = "null";
  let lastNote: OpenNote | null = null;
  let switched = false;
  let syncState: string | null = null;
  let shares: string | null = null;
  let updatingShareId: string | null = null;
  let seenNotices = new Set<number>();

  function reset(): void {
    unhook?.();
    unhook = null;
    hooked = null;
    activeEngine = null;
    failureReport = INITIAL_AUTO_REFRESH_FAILURE_STATE;
    refreshNoticeShown = false;
    tree = null;
    tagFilter = null;
    shownFilter = null;
    tagsWritable = false;
    trash = "null";
    openPath = "null";
    note = "null";
    lastNote = null;
    switched = false;
    syncState = null;
    shares = null;
    updatingShareId = null;
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
      action: null,
    });
  }

  function clearRefreshNotice(): void {
    if (!refreshNoticeShown) return;
    refreshNoticeShown = false;
    emit("noticeCleared", { id: REFRESH_NOTICE_ID });
  }

  function emitShares(running: NativeRunningApp, state: SyncEngineState): void {
    const payload = buildSharesView({
      shares: state.shares,
      tree: state.workingTree,
      updatingId: updatingShareId,
      forgeId: running.session.coordinates.forge,
      linkBase: app.ports.navigation.shareLinkBase(),
    });
    const key = JSON.stringify(payload);
    if (key === shares) return;
    shares = key;
    emit("sharesChanged", payload);
  }

  function attach(running: NativeRunningApp): void {
    activeEngine = running.engine;
    if (hooked === running.autoRefresh) return;
    emitShares(running, running.engine.getState());
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

  function emitTree(state: SyncEngineState): void {
    const writable = state.synced?.tags.writable ?? false;
    let view =
      state.workingTree === null
        ? null
        : buildTagFilter(state.workingTree, tagFilter);
    const resolved = resolveTagFilter(
      tagFilter,
      { usedTags: view?.usedTags ?? [] },
      writable,
    );
    if (resolved !== tagFilter && state.workingTree !== null) {
      view = buildTagFilter(state.workingTree, resolved);
    }
    const unchanged =
      state.workingTree === tree &&
      resolved === shownFilter &&
      writable === tagsWritable;
    tagFilter = resolved;
    if (unchanged) return;
    tree = state.workingTree;
    shownFilter = resolved;
    tagsWritable = writable;
    emit("treeChanged", {
      tree: toTreeNodes(view?.tree ?? null),
      tagFilter,
      usedTags: [...(view?.usedTags ?? [])],
      tagsWritable: writable,
      tagOptions: COLOR_TAG_PALETTE.map((option) => ({
        tag: option.id,
        label: option.label,
      })),
    });
  }

  function emitTrash(state: SyncEngineState): void {
    if (state.visibleTrash === null) return;
    const entries = toTrashEntries(state.visibleTrash, now());
    const payload: CoreEvents["trashChanged"] = {
      entries,
      deleteConfirmation: {
        title: DELETE_PERMANENTLY_TITLE,
        message: DELETE_PERMANENTLY_MESSAGE,
      },
      emptyConfirmation: {
        title: EMPTY_TRASH_TITLE,
        message: describeEmptyTrash(entries.length),
      },
    };
    const key = JSON.stringify(payload);
    if (key === trash) return;
    trash = key;
    emit("trashChanged", payload);
  }

  function recordOpenNote(engine: SyncEngine, state: SyncEngineState): void {
    const running = app.current();
    if (running === null || running.engine !== engine) return;
    const path = state.openNote?.path ?? null;
    const key = JSON.stringify(path);
    if (key === openPath) return;
    openPath = key;
    if (path !== null) running.services.recentNotes.record([...path]);
  }

  function onState(engine: SyncEngine): void {
    const state = engine.getState();
    const forgeName = app.activeForgeName();

    emitTree(state);
    emitTrash(state);
    recordOpenNote(engine, state);
    const running = app.current();
    if (running !== null && running.engine === engine) {
      emitShares(running, state);
    }

    const view = toOpenNote(state, {
      forgeName,
      deviceName: app.deviceName,
    });
    const viewKey = JSON.stringify(view);
    if (viewKey !== note) {
      note = viewKey;
      const edits = remoteEdits(lastNote, view, switched);
      lastNote = view;
      switched = false;
      emit("noteChanged", { note: view, edits });
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
          action: noticeAction(notice),
        });
      }
    }
    seenNotices = new Set([...seenNotices].filter((id) => present.has(id)));

    const lastRefreshError =
      state.refresh.lastError === null
        ? null
        : toCoreError(state.refresh.lastError, { source: "sync", forgeName });
    const sync = syncStatePayload(state, lastRefreshError);
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
    noteSwitched() {
      switched = true;
    },
    updatingShare: () => updatingShareId,
    setUpdatingShare(id) {
      if (updatingShareId === id) return;
      updatingShareId = id;
      const running = app.current();
      if (running !== null && running.engine === activeEngine) {
        emitShares(running, running.engine.getState());
      }
    },
    setTagFilter(tag) {
      tagFilter = tag;
      if (activeEngine !== null) onState(activeEngine);
    },
    clearTagFilter() {
      if (tagFilter === null) return;
      tagFilter = null;
      if (activeEngine !== null) onState(activeEngine);
    },
    dispose() {
      stopListening();
      reset();
    },
  };
}
