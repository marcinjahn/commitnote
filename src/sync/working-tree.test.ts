import { describe, expect, it } from "vitest";
import type { ChangeSet, NotePath } from "../changes/change";
import type { FolderNode, NoteNode, NoteTree } from "../tree/note-tree";
import {
  appendChange,
  buildWorkingTree,
  findWorkingNode,
  localContentAt,
  rebaseChanges,
  type WorkingFolder,
} from "./working-tree";

function note(name: string, path: NotePath, blobSha = `sha-${name}`): NoteNode {
  return {
    kind: "note",
    name,
    path,
    storedPath: path.join("/"),
    blobSha,
  };
}

function folder(
  name: string,
  path: NotePath,
  children: readonly (NoteNode | FolderNode)[] = [],
): FolderNode {
  return {
    kind: "folder",
    name,
    path,
    storedPath: path.join("/"),
    children,
  };
}

function tree(root: FolderNode): NoteTree {
  return { root };
}

function childNames(node: WorkingFolder): string[] {
  return node.children.map((child) => child.name);
}

const SAMPLE_TREE: NoteTree = tree(
  folder(
    "",
    [],
    [
      note("Welcome", ["Welcome"]),
      folder(
        "Docs",
        ["Docs"],
        [
          note("Guide", ["Docs", "Guide"]),
          folder(
            "Notes",
            ["Docs", "Notes"],
            [note("Todo", ["Docs", "Notes", "Todo"])],
          ),
        ],
      ),
      folder("Empty", ["Empty"], []),
    ],
  ),
);

describe("buildWorkingTree", () => {
  it("applies create-note", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "create-note", path: ["New"], content: "hello" },
    ]);
    const node = findWorkingNode(working, ["New"]);
    expect(node).toEqual({
      kind: "note",
      name: "New",
      path: ["New"],
      syncedPath: null,
    });
  });

  it("applies update-note without changing structure or syncedPath", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "update-note", path: ["Welcome"], content: "updated" },
    ]);
    const node = findWorkingNode(working, ["Welcome"]);
    expect(node).toEqual({
      kind: "note",
      name: "Welcome",
      path: ["Welcome"],
      syncedPath: ["Welcome"],
    });
  });

  it("applies delete-note", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "delete-note", path: ["Welcome"] },
    ]);
    expect(findWorkingNode(working, ["Welcome"])).toBeUndefined();
  });

  it("applies create-folder", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "create-folder", path: ["Projects"] },
    ]);
    const node = findWorkingNode(working, ["Projects"]);
    expect(node).toEqual({
      kind: "folder",
      name: "Projects",
      path: ["Projects"],
      children: [],
    });
  });

  it("applies delete-folder, removing its contents", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "delete-folder", path: ["Docs"] },
    ]);
    expect(findWorkingNode(working, ["Docs"])).toBeUndefined();
    expect(findWorkingNode(working, ["Docs", "Guide"])).toBeUndefined();
  });

  it("applies rename-note, preserving syncedPath as the original location", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "rename-note", from: ["Welcome"], to: ["Hello"] },
    ]);
    expect(findWorkingNode(working, ["Welcome"])).toBeUndefined();
    expect(findWorkingNode(working, ["Hello"])).toEqual({
      kind: "note",
      name: "Hello",
      path: ["Hello"],
      syncedPath: ["Welcome"],
    });
  });

  it("applies rename-folder, moving contents while keeping each note's syncedPath", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "rename-folder", from: ["Docs"], to: ["Documents"] },
    ]);
    expect(findWorkingNode(working, ["Docs"])).toBeUndefined();

    const movedFolder = findWorkingNode(working, ["Documents"]);
    expect(movedFolder?.kind).toBe("folder");
    expect((movedFolder as WorkingFolder).path).toEqual(["Documents"]);

    const movedGuide = findWorkingNode(working, ["Documents", "Guide"]);
    expect(movedGuide).toEqual({
      kind: "note",
      name: "Guide",
      path: ["Documents", "Guide"],
      syncedPath: ["Docs", "Guide"],
    });

    const movedTodo = findWorkingNode(working, ["Documents", "Notes", "Todo"]);
    expect(movedTodo).toEqual({
      kind: "note",
      name: "Todo",
      path: ["Documents", "Notes", "Todo"],
      syncedPath: ["Docs", "Notes", "Todo"],
    });
  });

  it("sorts children folders-first then by compareNames after a create", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [
      { kind: "create-note", path: ["Ahead"], content: "" },
      { kind: "create-folder", path: ["Zeta"] },
    ]);
    expect(childNames(working.root)).toEqual([
      "Docs",
      "Empty",
      "Zeta",
      "Ahead",
      "Welcome",
    ]);
  });

  it("has an empty-name, empty-path root", () => {
    const working = buildWorkingTree(SAMPLE_TREE, []);
    expect(working.root.name).toBe("");
    expect(working.root.path).toEqual([]);
  });

  it("throws RangeError on an invalid sequence", () => {
    expect(() =>
      buildWorkingTree(SAMPLE_TREE, [
        { kind: "update-note", path: ["DoesNotExist"], content: "x" },
      ]),
    ).toThrow(RangeError);
  });

  it("throws RangeError when creating a note under a missing folder", () => {
    expect(() =>
      buildWorkingTree(SAMPLE_TREE, [
        { kind: "create-note", path: ["Missing", "Note"], content: "x" },
      ]),
    ).toThrow(RangeError);
  });
});

describe("appendChange", () => {
  it("coalesces repeated typing into one update-note", () => {
    let changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
    ];
    changes = appendChange(changes, {
      kind: "update-note",
      path: ["Welcome"],
      content: "v2",
    });
    changes = appendChange(changes, {
      kind: "update-note",
      path: ["Welcome"],
      content: "v3",
    });
    expect(changes).toEqual([
      { kind: "update-note", path: ["Welcome"], content: "v3" },
    ]);
  });

  it("coalesces typing into an earlier create-note, keeping its kind", () => {
    let changes: ChangeSet = [
      { kind: "create-note", path: ["New"], content: "v1" },
    ];
    changes = appendChange(changes, {
      kind: "update-note",
      path: ["New"],
      content: "v2",
    });
    expect(changes).toEqual([
      { kind: "create-note", path: ["New"], content: "v2" },
    ]);
  });

  it("does not coalesce across a delete of the note", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "delete-note", path: ["Welcome"] },
    ];
    const result = appendChange(changes, {
      kind: "update-note",
      path: ["Welcome"],
      content: "v2",
    });
    expect(result).toEqual([
      ...changes,
      { kind: "update-note", path: ["Welcome"], content: "v2" },
    ]);
  });

  it("does not coalesce across a rename of the note itself", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "rename-note", from: ["Welcome"], to: ["Hi"] },
    ];
    const result = appendChange(changes, {
      kind: "update-note",
      path: ["Welcome"],
      content: "v2",
    });
    expect(result).toEqual([
      ...changes,
      { kind: "update-note", path: ["Welcome"], content: "v2" },
    ]);
  });

  it("does not coalesce across a rename of the note's containing folder", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Docs", "Guide"], content: "v1" },
      { kind: "rename-folder", from: ["Docs"], to: ["Documents"] },
    ];
    const result = appendChange(changes, {
      kind: "update-note",
      path: ["Docs", "Guide"],
      content: "v2",
    });
    expect(result).toEqual([
      ...changes,
      { kind: "update-note", path: ["Docs", "Guide"], content: "v2" },
    ]);
  });

  it("appends every other change kind unchanged", () => {
    const changes: ChangeSet = [];
    const created = appendChange(changes, {
      kind: "create-note",
      path: ["New"],
      content: "x",
    });
    const renamed = appendChange(created, {
      kind: "rename-note",
      from: ["New"],
      to: ["Newer"],
    });
    expect(renamed).toEqual([
      { kind: "create-note", path: ["New"], content: "x" },
      { kind: "rename-note", from: ["New"], to: ["Newer"] },
    ]);
  });

  it("never reorders or removes existing entries", () => {
    const changes: ChangeSet = [
      { kind: "create-folder", path: ["Projects"] },
      { kind: "create-note", path: ["Projects", "A"], content: "a" },
    ];
    const result = appendChange(changes, {
      kind: "update-note",
      path: ["Projects", "A"],
      content: "a2",
    });
    expect(result[0]).toEqual(changes[0]);
    expect(result).toHaveLength(2);
  });
});

describe("localContentAt", () => {
  it("returns undefined when no content change applies", () => {
    expect(localContentAt([], ["Welcome"])).toBeUndefined();
  });

  it("returns the latest create/update content", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "update-note", path: ["Welcome"], content: "v2" },
    ];
    expect(localContentAt(changes, ["Welcome"])).toBe("v2");
  });

  it("carries content through a note rename", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "hello" },
      { kind: "rename-note", from: ["Welcome"], to: ["Hi"] },
    ];
    expect(localContentAt(changes, ["Hi"])).toBe("hello");
    expect(localContentAt(changes, ["Welcome"])).toBeUndefined();
  });

  it("carries content through a folder rename", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Docs", "Guide"], content: "guide text" },
      { kind: "rename-folder", from: ["Docs"], to: ["Documents"] },
    ];
    expect(localContentAt(changes, ["Documents", "Guide"])).toBe("guide text");
    expect(localContentAt(changes, ["Docs", "Guide"])).toBeUndefined();
  });

  it("has no local content for a note deleted after its update", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "delete-note", path: ["Welcome"] },
    ];
    expect(localContentAt(changes, ["Welcome"])).toBeUndefined();
  });

  it("has no local content for a note removed by a folder delete", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Docs", "Guide"], content: "v1" },
      { kind: "delete-folder", path: ["Docs"] },
    ];
    expect(localContentAt(changes, ["Docs", "Guide"])).toBeUndefined();
  });
});

describe("rebaseChanges", () => {
  it("keeps a change whose preconditions still hold", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "update-note", path: ["Welcome"], content: "v2" }],
    );
    expect(result.changes).toEqual([
      { kind: "update-note", path: ["Welcome"], content: "v2" },
    ]);
    expect(result.dropped).toEqual([]);
  });

  it("throws RangeError when the prefix does not apply", () => {
    expect(() =>
      rebaseChanges(
        SAMPLE_TREE,
        [{ kind: "update-note", path: ["Gone"], content: "x" }],
        [],
      ),
    ).toThrow(RangeError);
  });

  it("turns an update-note whose note is gone into a create-note, creating missing ancestor folders", () => {
    const prefix: ChangeSet = [{ kind: "delete-note", path: ["Welcome"] }];
    const result = rebaseChanges(SAMPLE_TREE, prefix, [
      { kind: "update-note", path: ["New", "Nested"], content: "restored" },
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.changes).toEqual([
      { kind: "create-folder", path: ["New"] },
      {
        kind: "create-note",
        path: ["New", "Nested"],
        content: "restored",
      },
    ]);
  });

  it("drops an update-note blocked by a folder occupying its path", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "update-note", path: ["Docs"], content: "x" }],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "update-note", path: ["Docs"], content: "x" },
    ]);
  });

  it("drops an update-note blocked by a note occupying an ancestor folder segment", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [
        {
          kind: "update-note",
          path: ["Welcome", "Nested"],
          content: "x",
        },
      ],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "update-note", path: ["Welcome", "Nested"], content: "x" },
    ]);
  });

  it("turns a create-note whose target is occupied by a note into an update-note", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "create-note", path: ["Welcome"], content: "new content" }],
    );
    expect(result.dropped).toEqual([]);
    expect(result.changes).toEqual([
      { kind: "update-note", path: ["Welcome"], content: "new content" },
    ]);
  });

  it("drops a create-note whose target is occupied by a folder", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "create-note", path: ["Docs"], content: "x" }],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "create-note", path: ["Docs"], content: "x" },
    ]);
  });

  it("drops a create under a missing parent", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "create-note", path: ["Missing", "Note"], content: "x" }],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "create-note", path: ["Missing", "Note"], content: "x" },
    ]);
  });

  it("silently skips a create-folder whose folder already exists", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "create-folder", path: ["Docs"] }],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a create-folder whose target is occupied by a note", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "create-folder", path: ["Welcome"] }],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "create-folder", path: ["Welcome"] },
    ]);
  });

  it("silently skips a delete-note whose target no longer exists", () => {
    const prefix: ChangeSet = [{ kind: "delete-note", path: ["Welcome"] }];
    const result = rebaseChanges(SAMPLE_TREE, prefix, [
      { kind: "delete-note", path: ["Welcome"] },
    ]);
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("silently skips a delete-folder whose target no longer exists", () => {
    const prefix: ChangeSet = [{ kind: "delete-folder", path: ["Docs"] }];
    const result = rebaseChanges(SAMPLE_TREE, prefix, [
      { kind: "delete-folder", path: ["Docs"] },
    ]);
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a rename whose source is missing", () => {
    const prefix: ChangeSet = [{ kind: "delete-note", path: ["Welcome"] }];
    const result = rebaseChanges(SAMPLE_TREE, prefix, [
      { kind: "rename-note", from: ["Welcome"], to: ["Hi"] },
    ]);
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "rename-note", from: ["Welcome"], to: ["Hi"] },
    ]);
  });

  it("drops a rename whose target is occupied", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [
        {
          kind: "rename-note",
          from: ["Docs", "Guide"],
          to: ["Welcome"],
        },
      ],
    );
    expect(result.changes).toEqual([]);
    expect(result.dropped).toEqual([
      { kind: "rename-note", from: ["Docs", "Guide"], to: ["Welcome"] },
    ]);
  });

  it("keeps every kept change and applies them in order for a later change to see", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [
        { kind: "create-note", path: ["Fresh"], content: "x" },
        { kind: "rename-note", from: ["Fresh"], to: ["Renamed"] },
      ],
    );
    expect(result.dropped).toEqual([]);
    expect(result.changes).toEqual([
      { kind: "create-note", path: ["Fresh"], content: "x" },
      { kind: "rename-note", from: ["Fresh"], to: ["Renamed"] },
    ]);
  });
});
