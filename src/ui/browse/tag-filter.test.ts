import { describe, expect, it } from "vitest";
import type { ColorTag } from "../../tags/color-tag";
import type {
  WorkingFolder,
  WorkingNote,
  WorkingNode,
  WorkingTree,
} from "../../sync/working-tree";
import { buildTagFilter } from "./tag-filter";

function note(path: readonly string[], colorTag: ColorTag | null = null): WorkingNote {
  return {
    kind: "note",
    name: path[path.length - 1]!,
    path,
    syncedPath: null,
    colorTag,
    shared: false,
  };
}

function folder(
  path: readonly string[],
  children: readonly WorkingNode[],
): WorkingFolder {
  return { kind: "folder", name: path[path.length - 1]!, path, children };
}

function treeOf(children: readonly WorkingNode[]): WorkingTree {
  return { root: folder([], children) };
}

describe("buildTagFilter", () => {
  it("reports no used tags and returns the same tree for null when nothing is tagged", () => {
    const tree = treeOf([note(["a"]), folder(["F"], [note(["F", "b"])])]);
    const view = buildTagFilter(tree, null);
    expect(view.usedTags).toEqual([]);
    expect(view.tree).toBe(tree);
  });

  it("returns the same tree for null even when notes are tagged", () => {
    const tree = treeOf([note(["a"], "red")]);
    expect(buildTagFilter(tree, null).tree).toBe(tree);
  });

  it("orders used tags by palette regardless of tree order", () => {
    const tree = treeOf([
      note(["a"], "purple"),
      folder(["F"], [note(["F", "b"], "red"), note(["F", "c"], "green")]),
      note(["d"], "yellow"),
    ]);
    expect(buildTagFilter(tree, null).usedTags).toEqual([
      "red",
      "yellow",
      "green",
      "purple",
    ]);
  });

  it("collapses duplicate tags", () => {
    const tree = treeOf([
      note(["a"], "blue"),
      note(["b"], "blue"),
      folder(["F"], [note(["F", "c"], "blue")]),
    ]);
    expect(buildTagFilter(tree, null).usedTags).toEqual(["blue"]);
  });

  it("keeps matching notes with their ancestors and drops siblings", () => {
    const match = note(["F", "G", "m"], "red");
    const tree = treeOf([
      note(["top"], "blue"),
      folder(
        ["F"],
        [note(["F", "x"], "blue"), folder(["F", "G"], [match, note(["F", "G", "n"])])],
      ),
    ]);
    const { tree: filtered } = buildTagFilter(tree, "red");
    expect(filtered.root.children).toEqual([
      folder(["F"], [folder(["F", "G"], [match])]),
    ]);
  });

  it("drops folders without matches and empty folders", () => {
    const tree = treeOf([
      folder(["Empty"], []),
      folder(["Other"], [note(["Other", "a"], "blue")]),
      folder(["Hit"], [note(["Hit", "b"], "red")]),
    ]);
    const { tree: filtered } = buildTagFilter(tree, "red");
    expect(filtered.root.children.map((c) => c.name)).toEqual(["Hit"]);
  });

  it("preserves child order", () => {
    const tree = treeOf([
      note(["c"], "red"),
      folder(["B"], [note(["B", "z"], "red"), note(["B", "a"], "red")]),
      note(["a"], "red"),
    ]);
    const { tree: filtered } = buildTagFilter(tree, "red");
    expect(filtered.root.children.map((c) => c.name)).toEqual(["c", "B", "a"]);
    const kept = filtered.root.children[1] as WorkingFolder;
    expect(kept.children.map((c) => c.name)).toEqual(["z", "a"]);
  });

  it("keeps the original note objects and creates new folder objects", () => {
    const match = note(["F", "m"], "green");
    const original = folder(["F"], [match]);
    const tree = treeOf([original]);
    const { tree: filtered } = buildTagFilter(tree, "green");
    const kept = filtered.root.children[0] as WorkingFolder;
    expect(kept).not.toBe(original);
    expect(kept.children[0]).toBe(match);
    expect(filtered).not.toBe(tree);
    expect(filtered.root.name).toBe(tree.root.name);
    expect(filtered.root.path).toBe(tree.root.path);
  });

  it("does not mutate the input", () => {
    const tree = treeOf([
      note(["a"], "blue"),
      folder(["F"], [note(["F", "b"], "red"), note(["F", "c"], "blue")]),
    ]);
    const snapshot = structuredClone(tree);
    buildTagFilter(tree, "red");
    expect(tree).toEqual(snapshot);
  });

  it("returns a root without children when nothing matches", () => {
    const tree = treeOf([note(["a"], "blue"), folder(["F"], [note(["F", "b"])])]);
    const view = buildTagFilter(tree, "red");
    expect(view.tree.root.children).toEqual([]);
    expect(view.usedTags).toEqual(["blue"]);
  });
});
