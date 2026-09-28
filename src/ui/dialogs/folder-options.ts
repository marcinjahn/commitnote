import type { NotePath } from "../../changes/change";
import {
  isWithinFolder,
  notePathEquals,
  parentPath,
} from "../../changes/change";
import type { WorkingFolder, WorkingTree } from "../../sync/working-tree";

export interface MoveTarget {
  readonly path: NotePath;
  readonly label: string;
  readonly depth: number;
  readonly disabled: boolean;
}

export function listMoveTargets(
  tree: WorkingTree,
  itemPath: NotePath,
  itemKind: "note" | "folder",
): MoveTarget[] {
  const currentParent = parentPath(itemPath);
  const excludeSubtree = itemKind === "folder";

  const targets: MoveTarget[] = [
    {
      path: [],
      label: "Notes (top level)",
      depth: 0,
      disabled: notePathEquals(currentParent, []),
    },
  ];

  function visit(folder: WorkingFolder, depth: number): void {
    for (const child of folder.children) {
      if (child.kind !== "folder") continue;
      if (
        excludeSubtree &&
        (notePathEquals(child.path, itemPath) ||
          isWithinFolder(child.path, itemPath))
      ) {
        continue;
      }
      targets.push({
        path: child.path,
        label: child.name,
        depth,
        disabled: notePathEquals(child.path, currentParent),
      });
      visit(child, depth + 1);
    }
  }

  visit(tree.root, 1);

  return targets;
}

export function countDescendants(folder: WorkingFolder): number {
  let count = 0;
  for (const child of folder.children) {
    count += 1;
    if (child.kind === "folder") {
      count += countDescendants(child);
    }
  }
  return count;
}
