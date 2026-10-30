import type { ShareEntry } from "../../share/share-index";
import { findWorkingNode, type WorkingTree } from "../../sync/working-tree";

export function canOpenShare(
  entry: ShareEntry,
  tree: WorkingTree | null,
): boolean {
  return (
    entry.note.state === "active" &&
    (tree === null || findWorkingNode(tree, entry.note.path) !== undefined)
  );
}

export function latestShareDate(entry: ShareEntry): string {
  return entry.updatedAt !== null && entry.updatedAt > entry.sharedAt
    ? entry.updatedAt
    : entry.sharedAt;
}
