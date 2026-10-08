import type { NotePath } from "../changes/change";
import { isWithinFolder, notePathEquals } from "../changes/change";
import { isExpired } from "../trash/expiry";
import type { WorkingNode } from "./working-tree";

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

interface UndecryptableWorkingTrashEntry {
  readonly id: string;
  readonly deletedAt: number;
  readonly undecryptable: true;
  readonly synced: true;
}

export type WorkingTrashEntry =
  ReadableWorkingTrashEntry | UndecryptableWorkingTrashEntry;

/** Entries past retention stay stored until purged, but are never shown. */
export function visibleTrashEntries(
  trash: readonly WorkingTrashEntry[],
  now: number,
): readonly ReadableWorkingTrashEntry[] {
  return trash.filter(
    (entry): entry is ReadableWorkingTrashEntry =>
      !entry.undecryptable && !isExpired(entry, now),
  );
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

export function findWorkingTrashedLocation(
  trash: readonly WorkingTrashEntry[],
  path: NotePath,
): { readonly entryId: string; readonly entryKind: "note" | "folder" } | null {
  let found: ReadableWorkingTrashEntry | null = null;
  for (const entry of trash) {
    if (entry.undecryptable) continue;
    if (found !== null && entry.deletedAt <= found.deletedAt) continue;
    const matches =
      entry.kind === "note"
        ? notePathEquals(entry.originalPath, path)
        : isWithinFolder(path, entry.originalPath) &&
          findTrashItem(entry, path.slice(entry.originalPath.length))?.kind ===
            "note";
    if (matches) found = entry;
  }
  return found === null ? null : { entryId: found.id, entryKind: found.kind };
}
