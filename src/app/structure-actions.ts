import {
  isAtOrWithin,
  notePathEquals,
  parentPath,
  type NotePath,
} from "../changes/change";
import type { ForgeId } from "../forge/repo-coordinates";
import { sharesWithin } from "../share/share-index";
import type { RevokeSharesResult } from "../share/share-service";
import type { SyncEngine, SyncEngineState } from "../sync/sync-engine";
import { findWorkingNode } from "../sync/working-tree";
import type { ColorTag } from "../tags/color-tag";
import { countDescendants } from "../ui/dialogs/folder-options";
import {
  describeMovedDown,
  describeMovedTo,
  describeMovedUp,
  describeStructureError,
} from "../ui/browse/structure-messages";
import { siblingMoveBefore } from "../ui/browse/sibling-move";
import { decideNameCommit } from "../ui/note/name-field-commit";
import { describeShareError, messageText } from "../ui/share/share-messages";
import {
  describeMovedToTrash,
  describeRevokeFailed,
  describeUndoError,
} from "../ui/trash/trash-messages";
import { draftSiblingNames } from "./note-draft-actions";

export type StructureActionOutcome =
  | { readonly kind: "ok"; readonly path: NotePath }
  | { readonly kind: "error"; readonly message: string };

export interface PlaceUndo {
  readonly path: NotePath;
  readonly parent: NotePath;
  readonly before: string | null;
}

export interface PlaceTarget {
  readonly parent: NotePath;
  readonly before: string | null;
}

export type PlaceOutcome =
  | {
      readonly kind: "placed";
      readonly path: NotePath;
      readonly notice: string | null;
      readonly undo: PlaceUndo;
    }
  | { readonly kind: "error"; readonly message: string };

export type NameCommitOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "restore" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ok"; readonly path: NotePath };

export type MoveAmongSiblingsOutcome =
  | { readonly kind: "none" }
  | PlaceOutcome;

export interface TrashPreview {
  readonly itemCount: number;
  readonly shareCount: number;
}

export interface TrashNodeDeps {
  readonly engine: Pick<SyncEngine, "getState" | "delete">;
  readonly revokeShares: (path: NotePath) => Promise<RevokeSharesResult>;
  readonly forgeId: ForgeId;
  readonly onRevoking?: (shareCount: number) => void;
  readonly proceed?: () => boolean;
}

export type TrashOutcome =
  | {
      readonly kind: "trashed";
      readonly path: NotePath;
      readonly entryId: string;
      readonly notice: string;
    }
  | { readonly kind: "deleted"; readonly path: NotePath }
  | { readonly kind: "sharesChanged"; readonly shareCount: number }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly shareCount: number | null;
    }
  | { readonly kind: "abandoned" };

export type UndoTrashOutcome =
  | { readonly kind: "ok"; readonly reopen: NotePath | null }
  | { readonly kind: "error"; readonly message: string };

function siblingNames(
  engine: Pick<SyncEngine, "getState">,
  parent: NotePath,
): string[] {
  return draftSiblingNames(engine.getState().workingTree, parent);
}

function outcomeOf(
  result: ReturnType<SyncEngine["rename"]>,
): StructureActionOutcome {
  return result.ok
    ? { kind: "ok", path: result.path }
    : { kind: "error", message: describeStructureError(result.error) };
}

export function renameNode(
  engine: Pick<SyncEngine, "rename">,
  path: NotePath,
  name: string,
): StructureActionOutcome {
  return outcomeOf(engine.rename(path, name));
}

export function commitNoteName(
  engine: Pick<SyncEngine, "getState" | "rename">,
  input: {
    readonly path: NotePath;
    readonly conflicted: boolean;
    readonly currentName: string;
    readonly value: string;
  },
): NameCommitOutcome {
  const decision = decideNameCommit({
    currentName: input.currentName,
    edited: input.value,
    siblingNames: siblingNames(engine, parentPath(input.path)).filter(
      (name) => name !== input.currentName,
    ),
    conflicted: input.conflicted,
  });
  switch (decision.kind) {
    case "noop":
      return { kind: "none" };
    case "restore":
      return { kind: "restore" };
    case "error":
      return { kind: "error", message: decision.message };
    case "commit":
      return outcomeOf(engine.rename(input.path, decision.name));
  }
}

export function moveNode(
  engine: Pick<SyncEngine, "move">,
  path: NotePath,
  parent: NotePath,
): StructureActionOutcome {
  return outcomeOf(engine.move(path, parent));
}

function followingSibling(
  siblings: readonly string[],
  name: string,
): string | null {
  return siblings[siblings.indexOf(name) + 1] ?? null;
}

export function placeNode(
  engine: Pick<SyncEngine, "getState" | "place">,
  path: NotePath,
  target: PlaceTarget,
): PlaceOutcome {
  const from = parentPath(path);
  const name = path[path.length - 1]!;
  const previousBefore = followingSibling(siblingNames(engine, from), name);

  const result = engine.place(path, target);
  if (!result.ok) {
    return { kind: "error", message: describeStructureError(result.error) };
  }
  return {
    kind: "placed",
    path: result.path,
    notice: notePathEquals(from, target.parent)
      ? null
      : describeMovedTo(name, target.parent),
    undo: { path: result.path, parent: from, before: previousBefore },
  };
}

export function moveAmongSiblings(
  engine: Pick<SyncEngine, "getState" | "place">,
  path: NotePath,
  direction: "up" | "down",
): MoveAmongSiblingsOutcome {
  const parent = parentPath(path);
  const name = path[path.length - 1]!;
  const siblings = siblingNames(engine, parent);
  const target = siblingMoveBefore(siblings, name, direction);
  if (target === null) return { kind: "none" };
  const previousBefore = followingSibling(siblings, name);

  const result = engine.place(path, { parent, before: target.before });
  if (!result.ok) {
    return { kind: "error", message: describeStructureError(result.error) };
  }
  return {
    kind: "placed",
    path: result.path,
    notice: direction === "up" ? describeMovedUp(name) : describeMovedDown(name),
    undo: { path: result.path, parent, before: previousBefore },
  };
}

export function undoPlace(
  engine: Pick<SyncEngine, "place">,
  undo: PlaceUndo,
): StructureActionOutcome {
  return outcomeOf(
    engine.place(undo.path, { parent: undo.parent, before: undo.before }),
  );
}

function shareCountWithin(
  shares: SyncEngineState["shares"],
  path: NotePath,
): number {
  return shares === null ? 0 : sharesWithin(shares, path).length;
}

export function trashPreview(
  state: Pick<SyncEngineState, "workingTree" | "shares">,
  path: NotePath,
): TrashPreview {
  const node =
    state.workingTree === null
      ? undefined
      : findWorkingNode(state.workingTree, path);
  return {
    itemCount: node?.kind === "folder" ? countDescendants(node) : 0,
    shareCount: shareCountWithin(state.shares, path),
  };
}

function isConflictedWithin(
  state: Pick<SyncEngineState, "conflicts">,
  path: NotePath,
): boolean {
  return state.conflicts.some((held) => isAtOrWithin(held.path, path));
}

// Shares are revoked before the item is trashed, so a failure leaves the
// item in place and no trashed note keeps a live link.
export async function trashNode(
  deps: TrashNodeDeps,
  path: NotePath,
  confirmedShareCount: number,
): Promise<TrashOutcome> {
  const { engine } = deps;
  const shareCount = shareCountWithin(engine.getState().shares, path);
  if (shareCount > 0) {
    if (confirmedShareCount === 0) {
      return { kind: "sharesChanged", shareCount };
    }
    if (isConflictedWithin(engine.getState(), path)) {
      return {
        kind: "error",
        message: describeStructureError({ kind: "conflicted" }),
        shareCount,
      };
    }
    deps.onRevoking?.(shareCount);
    const result = await deps.revokeShares(path);
    if (deps.proceed !== undefined && !deps.proceed()) {
      return { kind: "abandoned" };
    }
    const remaining = shareCountWithin(engine.getState().shares, path);
    if (!result.ok) {
      return {
        kind: "error",
        message: describeRevokeFailed(
          messageText(describeShareError(result.error, deps.forgeId)),
          result.revoked,
        ),
        shareCount: remaining,
      };
    }
    if (remaining > 0) return { kind: "sharesChanged", shareCount: remaining };
  }

  const result = engine.delete(path);
  if (!result.ok) {
    return {
      kind: "error",
      message: describeStructureError(result.error),
      shareCount: null,
    };
  }
  if (result.trashEntryId === undefined) return { kind: "deleted", path };
  return {
    kind: "trashed",
    path,
    entryId: result.trashEntryId,
    notice: describeMovedToTrash(path[path.length - 1]!),
  };
}

export function undoTrash(
  engine: Pick<SyncEngine, "getState" | "undoTrash">,
  entryId: string,
  reopenCandidate: NotePath | null = null,
): UndoTrashOutcome {
  const result = engine.undoTrash(entryId);
  if (!result.ok) {
    return { kind: "error", message: describeUndoError(result.error) };
  }
  const open = engine.getState().openNote;
  const reopen =
    reopenCandidate !== null &&
    (open?.kind === "missing" || open?.kind === "trashed") &&
    notePathEquals(open.path, reopenCandidate)
      ? reopenCandidate
      : null;
  return { kind: "ok", reopen };
}

export function restoreFromTrash(
  engine: Pick<SyncEngine, "moveFromTrash">,
  entryId: string,
  subPath: NotePath,
  parent: NotePath,
): StructureActionOutcome {
  return outcomeOf(engine.moveFromTrash(entryId, subPath, parent));
}

export function deleteFromTrash(
  engine: Pick<SyncEngine, "deleteFromTrash">,
  entryId: string,
): void {
  engine.deleteFromTrash([entryId]);
}

export function emptyTrash(engine: Pick<SyncEngine, "emptyTrash">): void {
  engine.emptyTrash();
}

export function setNodeColorTag(
  engine: Pick<SyncEngine, "setColorTag">,
  path: NotePath,
  tag: ColorTag | null,
): StructureActionOutcome {
  return outcomeOf(engine.setColorTag(path, tag));
}
