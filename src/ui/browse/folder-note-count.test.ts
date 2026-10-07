import { describe, expect, it } from "vitest";
import type {
  WorkingFolder,
  WorkingNote,
  WorkingNode,
} from "../../sync/working-tree";
import { countFolderNotes } from "./folder-note-count";

function note(path: readonly string[]): WorkingNote {
  return {
    kind: "note",
    name: path[path.length - 1]!,
    path,
    syncedPath: null,
    colorTag: null,
    shared: false,
  };
}

function folder(
  path: readonly string[],
  children: readonly WorkingNode[],
): WorkingFolder {
  return { kind: "folder", name: path[path.length - 1]!, path, children };
}

describe("countFolderNotes", () => {
  it("is 0 for an empty folder", () => {
    expect(countFolderNotes(folder(["A"], []))).toBe(0);
  });

  it("counts flat notes", () => {
    expect(
      countFolderNotes(folder(["A"], [note(["A", "x"]), note(["A", "y"])])),
    ).toBe(2);
  });

  it("counts notes in nested folders without counting the folders", () => {
    const tree = folder(
      ["A"],
      [
        note(["A", "x"]),
        folder(
          ["A", "B"],
          [note(["A", "B", "y"]), folder(["A", "B", "C"], [note(["A", "B", "C", "z"])])],
        ),
      ],
    );
    expect(countFolderNotes(tree)).toBe(3);
  });

  it("is 0 for a folder of only empty subfolders", () => {
    const tree = folder(
      ["A"],
      [folder(["A", "B"], []), folder(["A", "C"], [folder(["A", "C", "D"], [])])],
    );
    expect(countFolderNotes(tree)).toBe(0);
  });
});
