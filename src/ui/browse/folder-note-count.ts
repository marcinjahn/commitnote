import type { WorkingFolder } from "../../sync/working-tree";

export function countFolderNotes(folder: WorkingFolder): number {
  let count = 0;
  for (const child of folder.children) {
    count += child.kind === "note" ? 1 : countFolderNotes(child);
  }
  return count;
}
