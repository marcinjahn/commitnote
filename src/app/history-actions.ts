import { notePathEquals, parentPath, type NotePath } from "../changes/change";
import type { TreeEntry } from "../forge/forge-adapter";
import type { NoteHistory, NoteVersion } from "../history/note-history";
import type { RestorePlan } from "../history/plan-restore";
import {
  findRestorableImages,
  needsImageLookup,
} from "../history/restorable-images";
import type { SyncEngine, SyncEngineState } from "../sync/sync-engine";
import { validateName } from "../tree/note-names";
import { findNode } from "../tree/note-tree";
import { describeStructureError } from "../ui/browse/structure-messages";
import { describeNameError } from "../ui/dialogs/name-messages";
import {
  describeRestoreBlock,
  describeRestored,
  UNSAVED_BEFORE_RESTORE_MESSAGE,
} from "../ui/history/history-messages";

export type NoteStateResult =
  | { readonly ok: true; readonly path: NotePath }
  | { readonly ok: false; readonly message: string };

export interface NoteStateDeps {
  readonly engine: Pick<
    SyncEngine,
    "getState" | "editNote" | "rename"
  >;
  readonly siblingNames: (parent: NotePath, exclude?: string) => string[];
}

export interface RestoreDeps extends NoteStateDeps {
  readonly engine: Pick<
    SyncEngine,
    | "flush"
    | "getState"
    | "getPendingImage"
    | "addRestoredImages"
    | "editNote"
    | "rename"
  >;
  readonly noteHistory: Pick<NoteHistory, "listVersionTree">;
}

export interface RestoreUndo {
  readonly path: NotePath;
  readonly content: string | null;
  readonly name: string | null;
}

export interface RestoreGuard {
  readonly path: NotePath;
  readonly content: string;
}

export type RestoreOutcome =
  | { readonly kind: "stale" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "restored";
      readonly path: NotePath;
      readonly message: string;
      readonly undo: RestoreUndo;
      readonly guard: RestoreGuard | null;
    };

export type HistoryTarget =
  | { readonly kind: "unsaved" }
  | { readonly kind: "ready"; readonly head: string };

function noteName(path: NotePath): string {
  return path[path.length - 1]!;
}

// The name is checked up front so a failed rename leaves the content alone,
// and the edit goes first so the rename's save commits both together.
export function setNoteState(
  deps: NoteStateDeps,
  path: NotePath,
  content: string | null,
  name: string | null,
): NoteStateResult {
  const { engine } = deps;
  if (
    engine.getState().conflicts.some((held) => notePathEquals(held.path, path))
  ) {
    return {
      ok: false,
      message: describeStructureError({ kind: "conflicted" }),
    };
  }
  if (name !== null) {
    const validation = validateName(
      name,
      deps.siblingNames(parentPath(path), noteName(path)),
    );
    if (!validation.ok) {
      return { ok: false, message: describeNameError(validation.error) };
    }
  }
  if (content !== null) engine.editNote(path, content);
  if (name === null) return { ok: true, path };
  const result = engine.rename(path, name);
  return result.ok
    ? { ok: true, path: result.path }
    : { ok: false, message: describeStructureError(result.error) };
}

export async function historyTarget(
  engine: Pick<SyncEngine, "flush" | "getState">,
  path: NotePath,
): Promise<HistoryTarget> {
  try {
    await engine.flush();
  } catch {
    // Best effort: the history of what is saved can still be shown.
  }
  const synced = engine.getState().synced;
  const node = synced === null ? undefined : findNode(synced.tree, path);
  return synced === null || node?.kind !== "note"
    ? { kind: "unsaved" }
    : { kind: "ready", head: synced.head };
}

export async function restoreVersion(
  deps: RestoreDeps,
  input: {
    readonly path: NotePath;
    readonly plan: Extract<RestorePlan, { kind: "ready" }>;
    readonly version: NoteVersion;
    readonly isCurrent: () => boolean;
    readonly now: () => number;
  },
): Promise<RestoreOutcome> {
  const { engine } = deps;
  const { path, plan, version } = input;
  try {
    await engine.flush();
  } catch {
    // The note's sync state below tells whether its changes were saved.
  }
  const isPending = (imageId: string) =>
    engine.getPendingImage(imageId) !== undefined;
  let versionListing: readonly TreeEntry[] = [];
  const lookupImages = engine.getState().synced?.images;
  if (
    plan.content !== null &&
    lookupImages !== undefined &&
    needsImageLookup(plan.content, lookupImages, isPending)
  ) {
    try {
      versionListing = await deps.noteHistory.listVersionTree(version.sha);
    } catch {
      versionListing = [];
    }
  }
  const state = engine.getState();
  const open = state.openNote;
  if (
    !input.isCurrent() ||
    open?.kind !== "loaded" ||
    !notePathEquals(open.path, path)
  ) {
    return { kind: "stale" };
  }
  if (state.stopped !== null || state.suspended) {
    const message = describeRestoreBlock("unavailable");
    return message === null ? { kind: "stale" } : { kind: "error", message };
  }
  if (state.syncStates.stateOf(path).kind !== "synced") {
    return { kind: "error", message: UNSAVED_BEFORE_RESTORE_MESSAGE };
  }
  const previous = { content: open.content, name: noteName(path) };
  const currentImages = state.synced?.images;
  if (
    plan.content !== null &&
    currentImages !== undefined &&
    versionListing.length > 0
  ) {
    engine.addRestoredImages(
      findRestorableImages({
        content: plan.content,
        images: currentImages,
        isPending,
        versionListing,
      }),
    );
  }
  const result = setNoteState(deps, path, plan.content, plan.name);
  if (!result.ok) return { kind: "error", message: result.message };
  const restored = engine.getState().openNote;
  return {
    kind: "restored",
    path: result.path,
    message: describeRestored(version.committedAt, input.now()),
    undo: {
      path: result.path,
      content: plan.content === null ? null : previous.content,
      name: plan.name === null ? null : previous.name,
    },
    guard:
      restored?.kind === "loaded"
        ? { path: restored.path, content: restored.content }
        : null,
  };
}

export function undoRestoreApplies(
  guard: RestoreGuard,
  open: SyncEngineState["openNote"],
): boolean {
  return (
    open?.kind === "loaded" &&
    notePathEquals(open.path, guard.path) &&
    open.content === guard.content
  );
}

export function undoRestore(
  deps: NoteStateDeps,
  undo: RestoreUndo,
): NoteStateResult {
  return setNoteState(deps, undo.path, undo.content, undo.name);
}
