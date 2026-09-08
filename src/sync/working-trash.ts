import type { ChangeSet, NotePath } from "../changes/change";
import type { TrashEntry } from "../trash/trash-index";
import type { NoteTree } from "../tree/note-tree";
import { buildWorkingState, type WorkingNode } from "./working-tree";

export interface ReadableWorkingTrashEntry {
  readonly id: string;
  readonly deletedAt: number;
  readonly undecryptable: false;
  /** False while the trash change that created it is not committed yet. */
  readonly synced: boolean;
  readonly kind: "note" | "folder";
  readonly originalPath: NotePath;
  /** Paths in this tree are the original, untrashed ones. */
  readonly tree: WorkingNode;
}

export interface UndecryptableWorkingTrashEntry {
  readonly id: string;
  readonly deletedAt: number;
  readonly undecryptable: true;
  readonly synced: true;
}

export type WorkingTrashEntry =
  ReadableWorkingTrashEntry | UndecryptableWorkingTrashEntry;

export function buildWorkingTrash(
  synced: NoteTree,
  changes: ChangeSet,
  syncedTrash: readonly TrashEntry[],
): readonly WorkingTrashEntry[] {
  return buildWorkingState(synced, changes, syncedTrash).trash;
}

export function findWorkingTrashEntry(
  trash: readonly WorkingTrashEntry[],
  entryId: string,
): WorkingTrashEntry | undefined {
  return trash.find((entry) => entry.id === entryId);
}

/** `subPath` is relative to the entry's trashed item; `[]` is the item itself. */
export function findTrashItem(
  entry: ReadableWorkingTrashEntry,
  subPath: NotePath,
): WorkingNode | undefined {
  let current: WorkingNode = entry.tree;
  for (const name of subPath) {
    if (current.kind !== "folder") return undefined;
    const next: WorkingNode | undefined = current.children.find(
      (child) => child.name === name,
    );
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}
