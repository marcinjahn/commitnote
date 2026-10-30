import { historyTarget } from "../app/history-actions";
import { notePathEquals, type NotePath } from "../changes/change";
import { diffNote, type DiffItem } from "../history/line-diff";
import type {
  NoteHistoryCursor,
  NoteHistoryState,
  NoteVersion,
  VersionContent,
} from "../history/note-history";
import { planRestore, titleDiffers } from "../history/plan-restore";
import { isGroupShared, sharedVersionShas } from "../history/shared-versions";
import { buildVersionSections } from "../history/version-sections";
import { sharesOfNote } from "../share/share-index";
import type { SyncEngine, SyncEngineState } from "../sync/sync-engine";
import { describeSyncError } from "../ui/browse/sync-messages";
import {
  describeDateTime,
  describeDay,
  describeEvent,
  describeFinalNewline,
  describeFold,
  describeHistoryEnd,
  describeRestoreBlock,
  describeRestoreTitle,
  describeSession,
  describeTime,
  describeTitleChange,
  NOTE_NOT_OPEN_MESSAGE,
  RESTORE_LABEL,
  SAME_AS_CURRENT_MESSAGE,
  SAVE_FIRST_MESSAGE,
  SAVING_CHANGES_MESSAGE,
  TITLE_ONLY_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNDECRYPTABLE_VERSION_MESSAGE,
} from "../ui/history/history-messages";
import type {
  DiffItemView,
  DiffLineView,
  HistoryVersionView,
  HistoryView,
  PreviewBody,
  VersionPreview,
} from "./api";
import type { AppSession, NativeRunningApp } from "./app-session";
import type { EmitCoreEvent } from "./commands/command-context";

export type HistoryPhase =
  | { readonly kind: "saving" }
  | { readonly kind: "unsaved" }
  | { readonly kind: "ready"; readonly cursor: NoteHistoryCursor };

export interface OpenHistory {
  readonly owner: NativeRunningApp;
  readonly path: NotePath;
  readonly phase: HistoryPhase;
}

export interface RestoreContext {
  /** The open note, unsaved edits included; null when `path` is not the open, loaded note. */
  readonly current: { readonly content: string; readonly name: string } | null;
  readonly conflicted: boolean;
  readonly canSave: boolean;
}

export interface HistoryViews {
  current(): OpenHistory | null;
  /** Shows `path` as saving; resolves once it is unsaved or ready, unless replaced or closed meanwhile. */
  open(owner: NativeRunningApp, path: NotePath): Promise<void>;
  close(): void;
  /** A version `history` has loaded, or null. */
  version(history: OpenHistory, sha: string): NoteVersion | null;
  /** The version's contents, cached for as long as `history` is open; failed reads are not kept. */
  readContent(
    history: OpenHistory,
    version: NoteVersion,
  ): Promise<VersionContent>;
  dispose(): void;
}

function noteName(path: NotePath): string {
  return path[path.length - 1]!;
}

export function restoreContext(
  state: SyncEngineState,
  path: NotePath,
): RestoreContext {
  const open = state.openNote;
  return {
    current:
      open?.kind === "loaded" && notePathEquals(open.path, path)
        ? { content: open.content, name: noteName(path) }
        : null,
    conflicted: state.conflicts.some((held) => notePathEquals(held.path, path)),
    canSave: state.stopped === null && !state.suspended,
  };
}

export function buildHistoryView(input: {
  readonly path: NotePath;
  readonly phase: HistoryPhase["kind"];
  readonly state: NoteHistoryState | null;
  readonly shared: ReadonlySet<string>;
  readonly forgeName: string;
  readonly now: number;
}): HistoryView {
  const { path, state, shared } = input;
  const base = { path: [...path], phase: input.phase };
  if (input.phase !== "ready" || state === null) {
    return {
      ...base,
      message:
        input.phase === "saving" ? SAVING_CHANGES_MESSAGE : SAVE_FIRST_MESSAGE,
      sections: [],
      loading: false,
      error: null,
      end: null,
      canLoadMore: false,
    };
  }
  const currentName = noteName(path);
  const versionView = (
    version: NoteVersion,
    current: boolean,
  ): HistoryVersionView => ({
    sha: version.sha,
    time: describeTime(version.committedAt),
    dateTime: describeDateTime(version.committedAt),
    current,
    shared: shared.has(version.sha),
    events: version.events.map(describeEvent),
    name:
      version.name !== null && version.name !== currentName
        ? version.name
        : null,
  });
  const sections = buildVersionSections(state.versions).map((section) => ({
    title: describeDay(section.day, input.now),
    rows: section.rows.map((row) =>
      row.kind === "single"
        ? {
            kind: "single" as const,
            version: versionView(row.version, row.current),
          }
        : {
            kind: "session" as const,
            title: describeSession(
              row.versions[0]!.committedAt,
              row.versions[row.versions.length - 1]!.committedAt,
              row.versions.length,
            ),
            shared: isGroupShared(row.versions, shared),
            versions: row.versions.map((version) =>
              versionView(version, false),
            ),
          },
    ),
  }));
  const error =
    state.error === null
      ? null
      : describeSyncError(state.error, input.forgeName);
  const end = state.end === null ? null : describeHistoryEnd(state.end);
  return {
    ...base,
    message: null,
    sections,
    loading: state.loading,
    error,
    end,
    canLoadMore: !state.loading && error === null && end === null,
  };
}

function lineView(
  line: Extract<DiffItem, { kind: "line" }>["line"],
): DiffLineView {
  return line.kind === "same"
    ? { kind: "same", text: line.text }
    : {
        kind: line.kind,
        segments: line.segments.map((segment) => ({
          text: segment.text,
          changed: segment.changed,
        })),
      };
}

function itemView(item: DiffItem): DiffItemView {
  return item.kind === "line"
    ? { kind: "line", line: lineView(item.line) }
    : {
        kind: "fold",
        label: describeFold(item.lines.length),
        lines: item.lines.map((text) => ({ kind: "same", text })),
      };
}

function previewBody(
  current: string,
  version: string,
  titleChanged: boolean,
): PreviewBody {
  const diff = diffNote(current, version);
  if (diff.kind === "tooLarge") {
    return { kind: "tooLarge", message: TOO_LARGE_MESSAGE };
  }
  if (diff.added === 0 && diff.removed === 0 && diff.finalNewline === null) {
    return {
      kind: "unchanged",
      message: titleChanged ? TITLE_ONLY_MESSAGE : SAME_AS_CURRENT_MESSAGE,
    };
  }
  return {
    kind: "diff",
    items: diff.items.map(itemView),
    finalNewline:
      diff.finalNewline === null
        ? null
        : describeFinalNewline(diff.finalNewline),
  };
}

export function buildVersionPreview(input: {
  readonly content: VersionContent;
  readonly context: RestoreContext;
  readonly restoreTitle: boolean;
  readonly forgeName: string;
}): VersionPreview {
  const { content, context } = input;
  if (content.kind === "failed") {
    return {
      kind: "failed",
      message: describeSyncError(content.error, input.forgeName),
    };
  }
  if (content.kind === "undecryptable") {
    return { kind: "undecryptable", message: UNDECRYPTABLE_VERSION_MESSAGE };
  }
  const { current } = context;
  if (current === null) {
    return { kind: "closed", message: NOTE_NOT_OPEN_MESSAGE };
  }
  const titleChanged = content.name !== null && content.name !== current.name;
  const plan = planRestore({
    current,
    version: content,
    restoreTitle: input.restoreTitle,
    conflicted: context.conflicted,
    canSave: context.canSave,
  });
  return {
    kind: "version",
    titleChange: titleChanged
      ? describeTitleChange(current.name, content.name!)
      : null,
    body: previewBody(current.content, content.content, titleChanged),
    restoreTitle: titleDiffers(content, current.name)
      ? describeRestoreTitle(content.name!)
      : null,
    restore: {
      label: RESTORE_LABEL,
      enabled: plan.kind === "ready",
      reason:
        plan.kind === "blocked" ? describeRestoreBlock(plan.reason) : null,
    },
  };
}

interface HeldHistory extends OpenHistory {
  phase: HistoryPhase;
  readonly contents: Map<string, Promise<VersionContent>>;
  unsubscribe: (() => void) | null;
}

export function createHistoryViews(options: {
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
  readonly now: () => number;
}): HistoryViews {
  const { app, emit, now } = options;
  let held: HeldHistory | null = null;
  let shownKey: string | null = null;
  let builtFrom: {
    readonly phase: HistoryPhase;
    readonly state: NoteHistoryState | null;
    readonly shares: SyncEngineState["shares"];
  } | null = null;

  function emitView(history: HeldHistory): void {
    const { phase } = history;
    const state = phase.kind === "ready" ? phase.cursor.getState() : null;
    const shares = history.owner.engine.getState().shares;
    if (
      builtFrom !== null &&
      builtFrom.phase === phase &&
      builtFrom.state === state &&
      builtFrom.shares === shares
    ) {
      return;
    }
    builtFrom = { phase, state, shares };
    const view = buildHistoryView({
      path: history.path,
      phase: phase.kind,
      state,
      shared:
        shares === null
          ? new Set()
          : sharedVersionShas(sharesOfNote(shares, history.path)),
      forgeName: app.activeForgeName(),
      now: now(),
    });
    const key = JSON.stringify(view);
    if (key === shownKey) return;
    shownKey = key;
    emit("historyChanged", { history: view });
  }

  function release(): HeldHistory | null {
    const previous = held;
    previous?.unsubscribe?.();
    held = null;
    shownKey = null;
    builtFrom = null;
    return previous;
  }

  function close(): void {
    if (release() !== null) emit("historyChanged", { history: null });
  }

  function setPhase(history: HeldHistory, phase: HistoryPhase): void {
    history.phase = phase;
    if (phase.kind === "ready") {
      history.unsubscribe = phase.cursor.subscribe(() => {
        if (held === history) emitView(history);
      });
    } else {
      emitView(history);
    }
  }

  function openPathOf(engine: SyncEngine): NotePath | null {
    return engine.getState().openNote?.path ?? null;
  }

  const stopListening = app.onEngineState((engine) => {
    const history = held;
    if (history === null) return;
    if (
      engine === null ||
      app.current() !== history.owner ||
      history.owner.engine !== engine
    ) {
      close();
      return;
    }
    const path = openPathOf(engine);
    if (path === null || !notePathEquals(path, history.path)) {
      close();
      return;
    }
    emitView(history);
  });

  return {
    current() {
      const history = held;
      if (history === null || app.current() !== history.owner) return null;
      return history;
    },

    async open(owner, path) {
      release();
      const history: HeldHistory = {
        owner,
        path: [...path],
        phase: { kind: "saving" },
        contents: new Map(),
        unsubscribe: null,
      };
      held = history;
      emitView(history);
      const target = await historyTarget(owner.engine, path);
      if (held !== history) return;
      setPhase(
        history,
        target.kind === "ready"
          ? {
              kind: "ready",
              cursor: owner.services.noteHistory.open(path, target.head),
            }
          : { kind: "unsaved" },
      );
    },

    close,

    version(history, sha) {
      if (history.phase.kind !== "ready") return null;
      return (
        history.phase.cursor
          .getState()
          .versions.find((version) => version.sha === sha) ?? null
      );
    },

    async readContent(history, version) {
      const contents = (history as HeldHistory).contents;
      let pending = contents.get(version.sha);
      if (pending === undefined) {
        pending = history.owner.services.noteHistory
          .readVersion(version)
          .catch((): VersionContent => ({
            kind: "failed",
            error: { kind: "server" },
          }));
        contents.set(version.sha, pending);
      }
      const content = await pending;
      if (content.kind === "failed" && contents.get(version.sha) === pending) {
        contents.delete(version.sha);
      }
      return content;
    },

    dispose() {
      stopListening();
      release();
    },
  };
}
