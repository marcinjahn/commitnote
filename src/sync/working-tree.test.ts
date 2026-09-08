import { describe, expect, it } from "vitest";
import type { ChangeSet, NotePath } from "../changes/change";
import type { TrashEntry } from "../trash/trash-index";
import type { FolderNode, NoteNode, NoteTree, TreeNode } from "../tree/note-tree";
import {
  appendChange,
  buildWorkingState,
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

// Entry ids encode the depth of the trashed item's original path.
const WELCOME_ID = "20260930T100000Z-1-aaaaaaaa";
const DOCS_ID = "20260930T110000Z-1-bbbbbbbb";
const TODO_ID = "20260930T120000Z-3-cccccccc";
const OLD_NOTE_ID = "20260901T080000Z-2-dddddddd";
const OLD_FOLDER_ID = "20260902T080000Z-1-eeeeeeee";
const BROKEN_ID = "20260903T080000Z-1-ffffffff";

function trashEntry(id: string, item: TreeNode): TrashEntry {
  return {
    id,
    deletedAt: Date.parse(
      id.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z.*$/,
        "$1-$2-$3T$4:$5:$6Z",
      ),
    ),
    files: [],
    undecryptable: false,
    kind: item.kind,
    originalPath: item.path,
    storedRoot: item.storedPath,
    tree: item,
  };
}

const SYNCED_TRASH: readonly TrashEntry[] = [
  trashEntry(OLD_NOTE_ID, note("Old", ["Archive", "Old"], "sha-trashed-old")),
  trashEntry(
    OLD_FOLDER_ID,
    folder(
      "Trashed",
      ["Trashed"],
      [
        folder(
          "Inner",
          ["Trashed", "Inner"],
          [note("Deep", ["Trashed", "Inner", "Deep"], "sha-trashed-deep")],
        ),
        note("Top", ["Trashed", "Top"], "sha-trashed-top"),
      ],
    ),
  ),
  { id: BROKEN_ID, deletedAt: 0, files: [], undecryptable: true },
];

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

describe("buildWorkingState trash", () => {
  it("moves a trashed note out of the tree into a not yet synced trash entry", () => {
    const { tree: working, trash } = buildWorkingState(SAMPLE_TREE, [
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
    ]);

    expect(findWorkingNode(working, ["Welcome"])).toBeUndefined();
    expect(trash).toEqual([
      {
        id: WELCOME_ID,
        deletedAt: Date.UTC(2026, 8, 30, 10, 0, 0),
        undecryptable: false,
        synced: false,
        kind: "note",
        originalPath: ["Welcome"],
        tree: {
          kind: "note",
          name: "Welcome",
          path: ["Welcome"],
          syncedPath: ["Welcome"],
        },
      },
    ]);
  });

  it("moves a trashed folder with its contents, keeping original paths", () => {
    const { tree: working, trash } = buildWorkingState(SAMPLE_TREE, [
      { kind: "rename-note", from: ["Docs", "Guide"], to: ["Docs", "Manual"] },
      { kind: "trash-folder", path: ["Docs"], entryId: DOCS_ID },
    ]);

    expect(findWorkingNode(working, ["Docs"])).toBeUndefined();
    expect(trash).toHaveLength(1);
    const [entry] = trash;
    if (entry.undecryptable) throw new Error("expected a readable entry");
    expect(entry).toMatchObject({ kind: "folder", originalPath: ["Docs"] });
    expect(entry.tree).toEqual({
      kind: "folder",
      name: "Docs",
      path: ["Docs"],
      children: [
        {
          kind: "folder",
          name: "Notes",
          path: ["Docs", "Notes"],
          children: [
            {
              kind: "note",
              name: "Todo",
              path: ["Docs", "Notes", "Todo"],
              syncedPath: ["Docs", "Notes", "Todo"],
            },
          ],
        },
        {
          kind: "note",
          name: "Manual",
          path: ["Docs", "Manual"],
          syncedPath: ["Docs", "Guide"],
        },
      ],
    });
  });

  it("lists synced trash entries, undecryptable ones included, oldest first", () => {
    const { trash } = buildWorkingState(
      SAMPLE_TREE,
      [{ kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID }],
      SYNCED_TRASH,
    );

    expect(trash.map((entry) => [entry.id, entry.synced])).toEqual([
      [BROKEN_ID, true],
      [OLD_NOTE_ID, true],
      [OLD_FOLDER_ID, true],
      [WELCOME_ID, false],
    ]);
    expect(trash[0]).toEqual({
      id: BROKEN_ID,
      deletedAt: 0,
      undecryptable: true,
      synced: true,
    });
    const old = trash[1];
    if (old.undecryptable) throw new Error("expected a readable entry");
    expect(old.tree).toEqual({
      kind: "note",
      name: "Old",
      path: ["Archive", "Old"],
      syncedPath: null,
      trashBlobSha: "sha-trashed-old",
    });
  });

  it("restores a whole synced note entry to the chosen folder, carrying its trash blob", () => {
    const { tree: working, trash } = buildWorkingState(
      SAMPLE_TREE,
      [
        {
          kind: "restore-trash",
          entryId: OLD_NOTE_ID,
          subPath: [],
          target: "note",
          to: ["Docs", "Old"],
        },
      ],
      SYNCED_TRASH,
    );

    expect(findWorkingNode(working, ["Docs", "Old"])).toEqual({
      kind: "note",
      name: "Old",
      path: ["Docs", "Old"],
      syncedPath: null,
      trashBlobSha: "sha-trashed-old",
    });
    expect(trash.map((entry) => entry.id)).not.toContain(OLD_NOTE_ID);
  });

  it("restores a sub-item of a folder entry under a new name, leaving the rest in trash", () => {
    const { tree: working, trash } = buildWorkingState(
      SAMPLE_TREE,
      [
        {
          kind: "restore-trash",
          entryId: OLD_FOLDER_ID,
          subPath: ["Inner"],
          target: "folder",
          to: ["Recovered"],
        },
      ],
      SYNCED_TRASH,
    );

    expect(findWorkingNode(working, ["Recovered", "Deep"])).toEqual({
      kind: "note",
      name: "Deep",
      path: ["Recovered", "Deep"],
      syncedPath: null,
      trashBlobSha: "sha-trashed-deep",
    });
    const entry = trash.find((candidate) => candidate.id === OLD_FOLDER_ID);
    if (entry === undefined || entry.undecryptable) {
      throw new Error("expected the folder entry to stay");
    }
    expect(childNames(entry.tree as WorkingFolder)).toEqual(["Top"]);
  });

  it("restores a pending-trashed note, keeping its synced location", () => {
    const { tree: working, trash } = buildWorkingState(SAMPLE_TREE, [
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
      {
        kind: "restore-trash",
        entryId: WELCOME_ID,
        subPath: [],
        target: "note",
        to: ["Empty", "Welcome"],
      },
    ]);

    expect(findWorkingNode(working, ["Empty", "Welcome"])).toEqual({
      kind: "note",
      name: "Welcome",
      path: ["Empty", "Welcome"],
      syncedPath: ["Welcome"],
    });
    expect(trash).toEqual([]);
  });

  it("purges entries and ignores ids that are not in trash", () => {
    const { trash } = buildWorkingState(
      SAMPLE_TREE,
      [{ kind: "purge-trash", entryIds: [OLD_NOTE_ID, BROKEN_ID, DOCS_ID] }],
      SYNCED_TRASH,
    );

    expect(trash.map((entry) => entry.id)).toEqual([OLD_FOLDER_ID]);
  });

  it.each<{ description: string; changes: ChangeSet }>([
    {
      description: "trashing a note whose entry id has the wrong depth",
      changes: [{ kind: "trash-note", path: ["Welcome"], entryId: TODO_ID }],
    },
    {
      description: "trashing a folder as a note",
      changes: [{ kind: "trash-note", path: ["Docs"], entryId: DOCS_ID }],
    },
    {
      description: "trashing under an entry id already in trash",
      changes: [
        { kind: "trash-note", path: ["Welcome"], entryId: OLD_FOLDER_ID },
      ],
    },
    {
      description: "restoring a missing entry",
      changes: [
        {
          kind: "restore-trash",
          entryId: DOCS_ID,
          subPath: [],
          target: "folder",
          to: ["Docs2"],
        },
      ],
    },
    {
      description: "restoring an undecryptable entry",
      changes: [
        {
          kind: "restore-trash",
          entryId: BROKEN_ID,
          subPath: [],
          target: "folder",
          to: ["Broken"],
        },
      ],
    },
    {
      description: "restoring with the wrong target kind",
      changes: [
        {
          kind: "restore-trash",
          entryId: OLD_FOLDER_ID,
          subPath: ["Top"],
          target: "folder",
          to: ["Top"],
        },
      ],
    },
    {
      description: "restoring onto a taken name",
      changes: [
        {
          kind: "restore-trash",
          entryId: OLD_NOTE_ID,
          subPath: [],
          target: "note",
          to: ["Welcome"],
        },
      ],
    },
    {
      description: "restoring into a missing folder",
      changes: [
        {
          kind: "restore-trash",
          entryId: OLD_NOTE_ID,
          subPath: [],
          target: "note",
          to: ["Missing", "Old"],
        },
      ],
    },
  ])("throws RangeError for $description", ({ changes }) => {
    expect(() =>
      buildWorkingState(SAMPLE_TREE, changes, SYNCED_TRASH),
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

  it("does not coalesce across a trash of the note's containing folder", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Docs", "Guide"], content: "v1" },
      { kind: "trash-folder", path: ["Docs"], entryId: DOCS_ID },
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

  it("does not coalesce across a restore onto the note's path", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
      {
        kind: "restore-trash",
        entryId: WELCOME_ID,
        subPath: [],
        target: "note",
        to: ["Welcome"],
      },
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

  it("coalesces across a purge", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "purge-trash", entryIds: [OLD_NOTE_ID] },
    ];
    const result = appendChange(changes, {
      kind: "update-note",
      path: ["Welcome"],
      content: "v2",
    });
    expect(result).toEqual([
      { kind: "update-note", path: ["Welcome"], content: "v2" },
      { kind: "purge-trash", entryIds: [OLD_NOTE_ID] },
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

describe("localContentAt trash", () => {
  it("has no local content at the old path of a trashed note", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "unsaved" },
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
    ];
    expect(localContentAt(changes, ["Welcome"])).toBeUndefined();
  });

  it("keeps unsaved text of a note through trash and restore", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "unsaved" },
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
      {
        kind: "restore-trash",
        entryId: WELCOME_ID,
        subPath: [],
        target: "note",
        to: ["Empty", "Hello"],
      },
    ];
    expect(localContentAt(changes, ["Empty", "Hello"])).toBe("unsaved");
  });

  it("keeps unsaved text inside a folder restored in parts", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Docs", "Guide"], content: "guide" },
      { kind: "update-note", path: ["Docs", "Notes", "Todo"], content: "todo" },
      { kind: "trash-folder", path: ["Docs"], entryId: DOCS_ID },
      {
        kind: "restore-trash",
        entryId: DOCS_ID,
        subPath: ["Notes"],
        target: "folder",
        to: ["Back"],
      },
      {
        kind: "restore-trash",
        entryId: DOCS_ID,
        subPath: ["Guide"],
        target: "note",
        to: ["Guide"],
      },
    ];
    expect(localContentAt(changes, ["Back", "Todo"])).toBe("todo");
    expect(localContentAt(changes, ["Guide"])).toBe("guide");
  });

  it("drops trashed text when its entry is purged", () => {
    const changes: ChangeSet = [
      { kind: "update-note", path: ["Welcome"], content: "unsaved" },
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
      { kind: "purge-trash", entryIds: [WELCOME_ID] },
      {
        kind: "restore-trash",
        entryId: WELCOME_ID,
        subPath: [],
        target: "note",
        to: ["Welcome"],
      },
    ];
    expect(localContentAt(changes, ["Welcome"])).toBeUndefined();
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

  it("keeps a trash whose source still exists", () => {
    const change = {
      kind: "trash-folder",
      path: ["Docs"],
      entryId: DOCS_ID,
    } as const;
    const result = rebaseChanges(SAMPLE_TREE, [], [change]);
    expect(result).toEqual({ changes: [change], dropped: [] });
  });

  it("silently skips a trash whose source is gone or changed kind", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [{ kind: "delete-note", path: ["Welcome"] }],
      [
        { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
        { kind: "trash-note", path: ["Docs"], entryId: DOCS_ID },
      ],
    );
    expect(result).toEqual({ changes: [], dropped: [] });
  });

  it("keeps a restore of an entry trashed in the prefix", () => {
    const restore = {
      kind: "restore-trash",
      entryId: WELCOME_ID,
      subPath: [],
      target: "note",
      to: ["Welcome"],
    } as const;
    const result = rebaseChanges(
      SAMPLE_TREE,
      [{ kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID }],
      [restore],
    );
    expect(result).toEqual({ changes: [restore], dropped: [] });
  });

  it.each<{ description: string; prefix: ChangeSet; to: NotePath }>([
    {
      description: "its entry is gone",
      prefix: [{ kind: "purge-trash", entryIds: [OLD_FOLDER_ID] }],
      to: ["Inner"],
    },
    {
      description: "its sub-item is gone",
      prefix: [
        {
          kind: "restore-trash",
          entryId: OLD_FOLDER_ID,
          subPath: ["Inner"],
          target: "folder",
          to: ["Elsewhere"],
        },
      ],
      to: ["Inner"],
    },
    {
      description: "its target is taken",
      prefix: [{ kind: "create-note", path: ["Inner"], content: "" }],
      to: ["Inner"],
    },
    {
      description: "its target folder is gone",
      prefix: [{ kind: "delete-folder", path: ["Docs"] }],
      to: ["Docs", "Inner"],
    },
  ])("drops a restore when $description", ({ prefix, to }) => {
    const restore = {
      kind: "restore-trash",
      entryId: OLD_FOLDER_ID,
      subPath: ["Inner"],
      target: "folder",
      to,
    } as const;
    const result = rebaseChanges(SAMPLE_TREE, prefix, [restore], SYNCED_TRASH);
    expect(result).toEqual({ changes: [], dropped: [restore] });
  });

  it("filters purged ids to entries still in trash", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [{ kind: "purge-trash", entryIds: [OLD_NOTE_ID] }],
      [{ kind: "purge-trash", entryIds: [OLD_NOTE_ID, BROKEN_ID, DOCS_ID] }],
      SYNCED_TRASH,
    );
    expect(result).toEqual({
      changes: [{ kind: "purge-trash", entryIds: [BROKEN_ID] }],
      dropped: [],
    });
  });

  it("silently skips a purge of entries no longer in trash", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [],
      [{ kind: "purge-trash", entryIds: [DOCS_ID] }],
      SYNCED_TRASH,
    );
    expect(result).toEqual({ changes: [], dropped: [] });
  });
});
