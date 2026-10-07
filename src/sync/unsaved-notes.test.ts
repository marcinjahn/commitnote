import { describe, expect, it } from "vitest";
import type { Change, ChangeSet, NotePath } from "../changes/change";
import { computeSyncStates } from "./sync-state";
import { listUnsavedNotes } from "./unsaved-notes";
import type { WorkingFolder, WorkingNode, WorkingTree } from "./working-tree";

function note(parent: NotePath, name: string): WorkingNode {
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
  build: (path: NotePath) => readonly WorkingNode[] = () => [],
): WorkingFolder {
  const path = [...parent, name];
  return { kind: "folder", name, path, children: build(path) };
}

function treeOf(build: (path: NotePath) => readonly WorkingNode[]): WorkingTree {
  return { root: { kind: "folder", name: "", path: [], children: build([]) } };
}

const update = (...path: string[]): Change => ({
  kind: "update-note",
  path,
  content: "x",
});

function list(input: {
  pending?: ChangeSet;
  inFlight?: ChangeSet;
  conflicts?: readonly NotePath[];
  tree: WorkingTree;
}) {
  const pending = input.pending ?? [];
  const inFlight = input.inFlight ?? [];
  const conflicts = input.conflicts ?? [];
  const { unsavedCount } = computeSyncStates({
    pending,
    inFlight,
    failed: false,
    conflicts,
  });
  return listUnsavedNotes({
    pending,
    inFlight,
    conflicts,
    tree: input.tree,
    unsavedCount,
  });
}

describe("listUnsavedNotes", () => {
  it("returns nothing for empty input", () => {
    expect(list({ tree: treeOf(() => []) })).toEqual({ notes: [], others: 0 });
  });

  it("lists notes in tree order regardless of change order", () => {
    const tree = treeOf((root) => [
      note(root, "z.md"),
      folder(root, "docs", (docs) => [
        folder(docs, "deep", (deep) => [note(deep, "d.md")]),
        note(docs, "c.md"),
      ]),
      note(root, "a.md"),
    ]);

    const result = list({
      pending: [
        update("a.md"),
        update("docs", "c.md"),
        update("docs", "deep", "d.md"),
        update("z.md"),
      ],
      tree,
    });

    expect(result.notes).toEqual([
      ["z.md"],
      ["docs", "deep", "d.md"],
      ["docs", "c.md"],
      ["a.md"],
    ]);
    expect(result.others).toBe(0);
  });

  it("lists a note once when pending, in flight and in conflict", () => {
    const tree = treeOf((root) => [note(root, "a.md")]);

    const result = list({
      pending: [update("a.md")],
      inFlight: [update("a.md")],
      conflicts: [["a.md"]],
      tree,
    });

    expect(result).toEqual({ notes: [["a.md"]], others: 0 });
  });

  it("lists a renamed note under its new path", () => {
    const tree = treeOf((root) => [note(root, "new.md")]);

    const result = list({
      pending: [{ kind: "rename-note", from: ["old.md"], to: ["new.md"] }],
      tree,
    });

    expect(result).toEqual({ notes: [["new.md"]], others: 0 });
  });

  it("does not list a deleted note and counts its parent folder in others", () => {
    const tree = treeOf((root) => [
      folder(root, "docs", (docs) => [note(docs, "keep.md")]),
    ]);

    const result = list({
      pending: [{ kind: "delete-note", path: ["docs", "gone.md"] }],
      tree,
    });

    expect(result).toEqual({ notes: [], others: 1 });
  });

  it("counts folders, order-only changes and settings in others only", () => {
    const tree = treeOf((root) => [
      folder(root, "new-folder"),
      folder(root, "sorted", (sorted) => [note(sorted, "a.md")]),
      note(root, "a.md"),
    ]);

    const result = list({
      pending: [
        { kind: "create-folder", path: ["new-folder"] },
        {
          kind: "set-order",
          parent: ["sorted"],
          positions: [{ name: "a.md", key: "V" }],
        },
        { kind: "set-settings", values: { theme: "dark" } },
        update("a.md"),
      ],
      tree,
    });

    expect(result).toEqual({ notes: [["a.md"]], others: 3 });
  });
});
