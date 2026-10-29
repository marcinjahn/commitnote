import type { ReadableWorkingTrashEntry } from "../sync/working-trash";
import type { WorkingNode } from "../sync/working-tree";
import {
  describeDaysLeft,
  describeOriginalFolder,
} from "../ui/trash/trash-messages";
import type { TrashEntryView, TrashItemView } from "./api";

function toItem(node: WorkingNode, rootDepth: number): TrashItemView {
  return {
    kind: node.kind,
    name: node.name,
    subPath: node.path.slice(rootDepth),
    children:
      node.kind === "folder"
        ? node.children.map((child) => toItem(child, rootDepth))
        : [],
  };
}

export function toTrashEntries(
  entries: readonly ReadableWorkingTrashEntry[],
  now: number,
): TrashEntryView[] {
  return [...entries]
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      name: entry.tree.name,
      originalFolder: describeOriginalFolder(entry.originalPath),
      daysLeft: describeDaysLeft(entry.deletedAt, now),
      colorTag: entry.tree.kind === "note" ? entry.tree.colorTag : null,
      children:
        entry.tree.kind === "folder"
          ? entry.tree.children.map((child) =>
              toItem(child, entry.originalPath.length),
            )
          : [],
    }));
}
