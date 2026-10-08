import { describe, expect, it } from "vitest";
import type { NotePath } from "../../changes/change";
import type {
  WorkingFolder,
  WorkingNote,
  WorkingNode,
} from "../../sync/working-tree";
import {
  treeKeyTarget,
  typeaheadIndex,
  visibleRows,
  type VisibleRow,
} from "./tree-keyboard";

function note(parent: NotePath, name: string): WorkingNote {
  return {
    kind: "note",
    name,
    path: [...parent, name],
    syncedPath: null,
    colorTag: null,
    shared: false,
  };
}

function folder(
  parent: NotePath,
  name: string,
  build: (path: NotePath) => WorkingNode[] = () => [],
): WorkingFolder {
  const path = [...parent, name];
  return { kind: "folder", name, path, children: build(path) };
}

const root: WorkingFolder = {
  kind: "folder",
  name: "",
  path: [],
  children: [
    note([], "Alpha"),
    folder([], "Work", (p) => [
      note(p, "plan"),
      folder(p, "Deep", (d) => [note(d, "leaf")]),
    ]),
    folder([], "Empty"),
    folder([], "Closed", (p) => [note(p, "hidden")]),
    note([], "Zed"),
  ],
};

const OPEN = new Set(["Work", "Work/Deep", "Empty"]);
const isExpanded = (path: NotePath) => OPEN.has(path.join("/"));
const rows = visibleRows(root, isExpanded);
const names = rows.map((r) => r.name);

describe("visibleRows", () => {
  it("flattens depth-first, skipping children of collapsed folders", () => {
    expect(names).toEqual([
      "Alpha",
      "Work",
      "plan",
      "Deep",
      "leaf",
      "Empty",
      "Closed",
      "Zed",
    ]);
  });

  it("records level, parentIndex, kind and expanded", () => {
    expect(rows.map((r) => [r.level, r.parentIndex, r.kind, r.expanded])).toEqual(
      [
        [1, null, "note", false],
        [1, null, "folder", true],
        [2, 1, "note", false],
        [2, 1, "folder", true],
        [3, 3, "note", false],
        [1, null, "folder", true],
        [1, null, "folder", false],
        [1, null, "note", false],
      ],
    );
  });

  it("returns only top-level rows when everything is collapsed", () => {
    expect(visibleRows(root, () => false).map((r) => r.name)).toEqual([
      "Alpha",
      "Work",
      "Empty",
      "Closed",
      "Zed",
    ]);
  });

  it("returns no rows for an empty root", () => {
    expect(visibleRows(folder([], ""), () => true)).toEqual([]);
  });
});

const idx = (name: string) => names.indexOf(name);

describe("treeKeyTarget", () => {
  it("ArrowDown moves to the next row and stops at the end", () => {
    expect(treeKeyTarget(rows, idx("Alpha"), "ArrowDown")).toEqual({
      kind: "focus",
      index: 1,
    });
    expect(treeKeyTarget(rows, rows.length - 1, "ArrowDown")).toEqual({
      kind: "none",
    });
  });

  it("ArrowUp moves to the previous row and stops at the start", () => {
    expect(treeKeyTarget(rows, 1, "ArrowUp")).toEqual({
      kind: "focus",
      index: 0,
    });
    expect(treeKeyTarget(rows, 0, "ArrowUp")).toEqual({ kind: "none" });
  });

  it("Home and End jump to the first and last row", () => {
    expect(treeKeyTarget(rows, 4, "Home")).toEqual({ kind: "focus", index: 0 });
    expect(treeKeyTarget(rows, 2, "End")).toEqual({
      kind: "focus",
      index: rows.length - 1,
    });
  });

  it("ArrowRight expands a collapsed folder", () => {
    expect(treeKeyTarget(rows, idx("Closed"), "ArrowRight")).toEqual({
      kind: "expand",
      index: idx("Closed"),
    });
  });

  it("ArrowRight on an expanded folder focuses its first child", () => {
    expect(treeKeyTarget(rows, idx("Work"), "ArrowRight")).toEqual({
      kind: "focus",
      index: idx("plan"),
    });
  });

  it("ArrowRight does nothing on an expanded empty folder or a note", () => {
    expect(treeKeyTarget(rows, idx("Empty"), "ArrowRight")).toEqual({
      kind: "none",
    });
    expect(treeKeyTarget(rows, idx("Alpha"), "ArrowRight")).toEqual({
      kind: "none",
    });
  });

  it("ArrowLeft collapses an expanded folder", () => {
    expect(treeKeyTarget(rows, idx("Work"), "ArrowLeft")).toEqual({
      kind: "collapse",
      index: idx("Work"),
    });
  });

  it("ArrowLeft focuses the parent of a note or collapsed folder", () => {
    expect(treeKeyTarget(rows, idx("leaf"), "ArrowLeft")).toEqual({
      kind: "focus",
      index: idx("Deep"),
    });
    const collapsed = visibleRows(root, (p) => p.join("/") === "Work");
    const deep = collapsed.findIndex((r) => r.name === "Deep");
    expect(treeKeyTarget(collapsed, deep, "ArrowLeft")).toEqual({
      kind: "focus",
      index: 1,
    });
  });

  it("ArrowLeft does nothing on a top-level note or collapsed folder", () => {
    expect(treeKeyTarget(rows, idx("Alpha"), "ArrowLeft")).toEqual({
      kind: "none",
    });
    expect(treeKeyTarget(rows, idx("Closed"), "ArrowLeft")).toEqual({
      kind: "none",
    });
  });

  it("ignores other keys", () => {
    expect(treeKeyTarget(rows, 0, "Enter")).toEqual({ kind: "none" });
    expect(treeKeyTarget(rows, 0, "a")).toEqual({ kind: "none" });
  });

  it("returns none for empty rows or an out-of-range current", () => {
    expect(treeKeyTarget([], 0, "ArrowDown")).toEqual({ kind: "none" });
    expect(treeKeyTarget(rows, -1, "Home")).toEqual({ kind: "none" });
    expect(treeKeyTarget(rows, rows.length, "End")).toEqual({ kind: "none" });
  });
});

describe("typeaheadIndex", () => {
  const list: VisibleRow[] = ["Apple", "avocado", "Banana", "Cherry", "apricot"].map(
    (name) => ({
      path: [name],
      kind: "note",
      name,
      level: 1,
      expanded: false,
      parentIndex: null,
    }),
  );

  it("searches forward from the row after current", () => {
    expect(typeaheadIndex(list, 0, "c")).toBe(3);
    expect(typeaheadIndex(list, 2, "a")).toBe(4);
  });

  it("wraps around and finds current last", () => {
    expect(typeaheadIndex(list, 3, "b")).toBe(2);
    expect(typeaheadIndex(list, 3, "c")).toBe(3);
  });

  it("cycles through matches for a repeated letter", () => {
    expect(typeaheadIndex(list, 0, "aa")).toBe(1);
    expect(typeaheadIndex(list, 1, "aaa")).toBe(4);
    expect(typeaheadIndex(list, 4, "aa")).toBe(0);
  });

  it("matches a multi-letter prefix", () => {
    expect(typeaheadIndex(list, 0, "ap")).toBe(4);
    expect(typeaheadIndex(list, 4, "ap")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(typeaheadIndex(list, 0, "BAN")).toBe(2);
    expect(typeaheadIndex(list, 2, "AV")).toBe(1);
  });

  it("returns null without a match, for an empty query or no rows", () => {
    expect(typeaheadIndex(list, 0, "z")).toBeNull();
    expect(typeaheadIndex(list, 0, "")).toBeNull();
    expect(typeaheadIndex([], 0, "a")).toBeNull();
  });
});
