import type { NotePath } from "../../changes/change";
import type { WorkingFolder } from "../../sync/working-tree";

export interface VisibleRow {
  readonly path: NotePath;
  readonly kind: "note" | "folder";
  readonly name: string;
  readonly level: number;
  readonly expanded: boolean;
  readonly parentIndex: number | null;
}

export type TreeKeyResult =
  | { readonly kind: "focus"; readonly index: number }
  | { readonly kind: "expand"; readonly index: number }
  | { readonly kind: "collapse"; readonly index: number }
  | { readonly kind: "none" };

const NONE: TreeKeyResult = { kind: "none" };

export function visibleRows(
  root: WorkingFolder,
  isExpanded: (path: NotePath) => boolean,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (
    folder: WorkingFolder,
    level: number,
    parentIndex: number | null,
  ): void => {
    for (const child of folder.children) {
      const index = rows.length;
      if (child.kind === "note") {
        rows.push({
          path: child.path,
          kind: "note",
          name: child.name,
          level,
          expanded: false,
          parentIndex,
        });
        continue;
      }
      const expanded = isExpanded(child.path);
      rows.push({
        path: child.path,
        kind: "folder",
        name: child.name,
        level,
        expanded,
        parentIndex,
      });
      if (expanded && child.children.length > 0) {
        walk(child, level + 1, index);
      }
    }
  };
  walk(root, 1, null);
  return rows;
}

export function treeKeyTarget(
  rows: readonly VisibleRow[],
  current: number,
  key: string,
): TreeKeyResult {
  const row = rows[current];
  if (row === undefined) return NONE;
  switch (key) {
    case "ArrowDown":
      return current + 1 < rows.length
        ? { kind: "focus", index: current + 1 }
        : NONE;
    case "ArrowUp":
      return current > 0 ? { kind: "focus", index: current - 1 } : NONE;
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: rows.length - 1 };
    case "ArrowRight": {
      if (row.kind !== "folder") return NONE;
      if (!row.expanded) return { kind: "expand", index: current };
      return rows[current + 1]?.parentIndex === current
        ? { kind: "focus", index: current + 1 }
        : NONE;
    }
    case "ArrowLeft": {
      if (row.kind === "folder" && row.expanded) {
        return { kind: "collapse", index: current };
      }
      return row.parentIndex !== null
        ? { kind: "focus", index: row.parentIndex }
        : NONE;
    }
    default:
      return NONE;
  }
}

export function typeaheadIndex(
  rows: readonly VisibleRow[],
  current: number,
  query: string,
): number | null {
  if (query === "" || rows.length === 0) return null;
  const chars = Array.from(query.toLocaleLowerCase());
  const prefix = chars.every((c) => c === chars[0]) ? chars[0]! : chars.join("");
  for (let step = 1; step <= rows.length; step++) {
    const index = (((current + step) % rows.length) + rows.length) % rows.length;
    if (rows[index]!.name.toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return null;
}
