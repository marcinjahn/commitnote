import { describe, expect, it } from "vitest";
import type { WorkingFolder, WorkingTree } from "../../sync/working-tree";
import { countDescendants, listMoveTargets } from "./folder-options";

function tree(): WorkingTree {
  const nested: WorkingFolder = {
    kind: "folder",
    name: "Nested",
    path: ["Alpha", "Nested"],
    children: [],
  };
  const alpha: WorkingFolder = {
    kind: "folder",
    name: "Alpha",
    path: ["Alpha"],
    children: [
      nested,
      {
        kind: "note",
        name: "note1",
        path: ["Alpha", "note1"],
        syncedPath: null,
      },
    ],
  };
  const beta: WorkingFolder = {
    kind: "folder",
    name: "Beta",
    path: ["Beta"],
    children: [],
  };
  const root: WorkingFolder = {
    kind: "folder",
    name: "",
    path: [],
    children: [
      alpha,
      beta,
      {
        kind: "note",
        name: "root-note",
        path: ["root-note"],
        syncedPath: null,
      },
    ],
  };
  return { root };
}

describe("listMoveTargets", () => {
  it("lists the top level entry first, then every folder in tree order, indented by depth", () => {
    const targets = listMoveTargets(tree(), ["root-note"], "note");

    expect(targets).toEqual([
      { path: [], label: "Notes (top level)", depth: 0, disabled: true },
      { path: ["Alpha"], label: "Alpha", depth: 1, disabled: false },
      {
        path: ["Alpha", "Nested"],
        label: "Nested",
        depth: 2,
        disabled: false,
      },
      { path: ["Beta"], label: "Beta", depth: 1, disabled: false },
    ]);
  });

  it("excludes the item itself and its descendants when moving a folder", () => {
    const targets = listMoveTargets(tree(), ["Alpha"], "folder");

    expect(targets.map((target) => target.path)).toEqual([[], ["Beta"]]);
  });

  it("does not exclude anything by subtree when moving a note", () => {
    const targets = listMoveTargets(tree(), ["Alpha", "note1"], "note");

    expect(targets.map((target) => target.path)).toEqual([
      [],
      ["Alpha"],
      ["Alpha", "Nested"],
      ["Beta"],
    ]);
  });

  it("disables the top level entry when it is the item's current parent", () => {
    const targets = listMoveTargets(tree(), ["root-note"], "note");
    const topLevel = targets.find((target) => target.path.length === 0);

    expect(topLevel?.disabled).toBe(true);
  });

  it("disables the folder that is the item's current parent", () => {
    const targets = listMoveTargets(tree(), ["Alpha", "note1"], "note");
    const alphaOption = targets.find(
      (target) => target.path.join("/") === "Alpha",
    );
    const topLevel = targets.find((target) => target.path.length === 0);

    expect(alphaOption?.disabled).toBe(true);
    expect(topLevel?.disabled).toBe(false);
  });
});

describe("countDescendants", () => {
  it("counts notes and folders inside a folder, recursively", () => {
    const workingTree = tree();
    const alpha = workingTree.root.children.find(
      (child) => child.name === "Alpha",
    ) as WorkingFolder;

    expect(countDescendants(alpha)).toBe(2);
  });

  it("counts the whole tree from the root", () => {
    expect(countDescendants(tree().root)).toBe(5);
  });

  it("returns 0 for an empty folder", () => {
    const empty: WorkingFolder = {
      kind: "folder",
      name: "Empty",
      path: ["Empty"],
      children: [],
    };

    expect(countDescendants(empty)).toBe(0);
  });
});

describe("listMoveTargets for an item outside the tree", () => {
  it("disables nothing and excludes no folder", () => {
    const targets = listMoveTargets(tree(), null, "folder");
    expect(targets.every((target) => !target.disabled)).toBe(true);
    expect(targets.map((target) => target.label)).toContain("Nested");
  });
});
