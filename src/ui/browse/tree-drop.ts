import type { NotePath } from "../../changes/change";
import {
  isWithinFolder,
  notePathEquals,
  parentPath,
} from "../../changes/change";

export interface DropRow {
  readonly path: NotePath;
  readonly kind: "note" | "folder";
  readonly top: number;
  readonly height: number;
}

export interface DropScene {
  /** Every visible row in display order, the dragged one included. */
  readonly rows: readonly DropRow[];
  readonly dragged: NotePath;
  readonly draggedKind: "note" | "folder";
  /** The dragged item is or contains a held conflict. */
  readonly conflicted: boolean;
  /** Child names of a folder in display order, undefined if there is none. */
  readonly childrenOf: (folder: NotePath) => readonly string[] | undefined;
  /** Pointer x where depth 0 starts, and the indent of each level. */
  readonly indentStart: number;
  readonly indentStep: number;
}

export interface DropTarget {
  readonly parent: NotePath;
  readonly before: string | null;
}

export type DropHit =
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused" }
  | {
      readonly kind: "drop";
      readonly target: DropTarget;
      /** Dropped onto the folder row `target.parent` itself. */
      readonly into: boolean;
      /** Rows from this index on make room for the dropped item. */
      readonly gapIndex: number;
      readonly depth: number;
    };

const FOLDER_EDGE = 0.25;

function depthOf(row: DropRow): number {
  return row.path.length - 1;
}

function nameOf(path: NotePath): string {
  return path[path.length - 1];
}

/**
 * Where an item dropped at (x, y) goes. `y` is in the same coordinates as
 * the row tops. A folder row takes items before it in its top quarter and
 * into it in the middle half; below it, or below a note's middle, the item
 * goes after the row. After the last row of a folder, `x` picks how many
 * folders the item leaves.
 */
export function hitTestDrop(scene: DropScene, x: number, y: number): DropHit {
  const { rows } = scene;
  if (rows.length === 0) return candidate(scene, [], null, 0, 0, false);

  const last = rows[rows.length - 1];
  if (y >= last.top + last.height) {
    return candidate(scene, [], null, rows.length, 0, false);
  }

  const index = rows.findIndex((row) => y < row.top + row.height);
  const row = rows[index];
  const offset = (y - row.top) / row.height;
  const next = rows[index + 1];

  if (row.kind === "folder") {
    if (offset < FOLDER_EDGE) return before(scene, index);
    if (offset < 1 - FOLDER_EDGE) {
      return candidate(scene, row.path, null, -1, depthOf(row) + 1, true);
    }
    if (next !== undefined && depthOf(next) === depthOf(row) + 1) {
      return candidate(
        scene,
        row.path,
        nameOf(next.path),
        index + 1,
        depthOf(next),
        false,
      );
    }
    return after(scene, index, x);
  }
  return offset < 0.5 ? before(scene, index) : after(scene, index, x);
}

function before(scene: DropScene, index: number): DropHit {
  const row = scene.rows[index];
  return candidate(
    scene,
    parentPath(row.path),
    nameOf(row.path),
    index,
    depthOf(row),
    false,
  );
}

function after(scene: DropScene, index: number, x: number): DropHit {
  const row = scene.rows[index];
  const next = scene.rows[index + 1];
  const minDepth = next === undefined ? 0 : depthOf(next);
  const maxDepth = depthOf(row);
  const pointerDepth = Math.floor((x - scene.indentStart) / scene.indentStep);
  const depth = Math.min(maxDepth, Math.max(minDepth, pointerDepth));
  const parent = row.path.slice(0, depth);
  const beforeName =
    next !== undefined && depthOf(next) === depth ? nameOf(next.path) : null;
  return candidate(scene, parent, beforeName, index + 1, depth, false);
}

function candidate(
  scene: DropScene,
  parent: NotePath,
  beforeName: string | null,
  gapIndex: number,
  depth: number,
  into: boolean,
): DropHit {
  const { dragged } = scene;
  const name = nameOf(dragged);
  if (
    scene.draggedKind === "folder" &&
    (notePathEquals(parent, dragged) || isWithinFolder(parent, dragged))
  ) {
    return { kind: "refused" };
  }
  const siblings = scene.childrenOf(parent);
  if (siblings === undefined) return { kind: "refused" };

  if (notePathEquals(parent, parentPath(dragged))) {
    const next = siblings[siblings.indexOf(name) + 1] ?? null;
    if (beforeName === name || beforeName === next)
      return { kind: "unchanged" };
  } else if (scene.conflicted || siblings.includes(name)) {
    return { kind: "refused" };
  }
  return {
    kind: "drop",
    target: { parent, before: beforeName },
    into,
    gapIndex,
    depth,
  };
}
