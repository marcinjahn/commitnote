import { describe, expect, it } from "vitest";
import type { Change, ChangeSet, NotePath } from "../changes/change";
import { parseOrderIndex, type OrderIndex } from "../order/order-index";
import { parseTagIndex, tagKey, type TagIndex } from "../tags/tag-index";
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
  type WorkingNode,
} from "./working-tree";
import type { WorkingTrashEntry } from "./working-trash";

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
      colorTag: null,
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
      colorTag: null,
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
      colorTag: null,
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
      colorTag: null,
    });

    const movedTodo = findWorkingNode(working, ["Documents", "Notes", "Todo"]);
    expect(movedTodo).toEqual({
      kind: "note",
      name: "Todo",
      path: ["Documents", "Notes", "Todo"],
      syncedPath: ["Docs", "Notes", "Todo"],
      colorTag: null,
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

describe("buildWorkingTree order", () => {
  function order(folders: Record<string, Record<string, string>>): OrderIndex {
    return parseOrderIndex(JSON.stringify({ version: 1, folders }));
  }

  const ORDER = order({
    [JSON.stringify([])]: { Welcome: "F", Empty: "V" },
    [JSON.stringify(["Docs"])]: { Notes: "V", Guide: "k" },
  });

  function rootNames(changes: ChangeSet): string[] {
    return childNames(buildWorkingTree(SAMPLE_TREE, changes, [], ORDER).root);
  }

  it("lists positioned children by their stored position, then the rest folders first", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [], [], ORDER);

    expect(childNames(working.root)).toEqual(["Welcome", "Empty", "Docs"]);
    expect(
      childNames(findWorkingNode(working, ["Docs"]) as WorkingFolder),
    ).toEqual(["Notes", "Guide"]);
  });

  it("places a new item after the positioned ones", () => {
    expect(
      rootNames([{ kind: "create-folder", path: ["Archive"] }]),
    ).toEqual(["Welcome", "Empty", "Archive", "Docs"]);
  });

  it("keeps an item's position when it is renamed in place", () => {
    expect(
      rootNames([{ kind: "rename-note", from: ["Welcome"], to: ["Hello"] }]),
    ).toEqual(["Hello", "Empty", "Docs"]);
  });

  it("keeps the positions inside a renamed folder", () => {
    const working = buildWorkingTree(
      SAMPLE_TREE,
      [{ kind: "rename-folder", from: ["Docs"], to: ["Manuals"] }],
      [],
      ORDER,
    );

    expect(
      childNames(findWorkingNode(working, ["Manuals"]) as WorkingFolder),
    ).toEqual(["Notes", "Guide"]);
  });

  it("gives an item moved into another folder no position there", () => {
    expect(
      rootNames([{ kind: "rename-note", from: ["Docs", "Guide"], to: ["Guide"] }]),
    ).toEqual(["Welcome", "Empty", "Docs", "Guide"]);
  });

  it("falls back to folders first and by name when the order can't be read", () => {
    const working = buildWorkingTree(SAMPLE_TREE, [], [], parseOrderIndex("?"));

    expect(childNames(working.root)).toEqual(["Docs", "Empty", "Welcome"]);
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
          colorTag: null,
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
              colorTag: null,
            },
          ],
        },
        {
          kind: "note",
          name: "Manual",
          path: ["Docs", "Manual"],
          syncedPath: ["Docs", "Guide"],
          colorTag: null,
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
      colorTag: null,
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
      colorTag: null,
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
      colorTag: null,
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
      colorTag: null,
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
  it("merges set-settings changes into one at the end, later values winning", () => {
    let changes: ChangeSet = [
      { kind: "set-settings", values: { a: 1, b: 1 } },
      { kind: "update-note", path: ["Welcome"], content: "v1" },
    ];
    changes = appendChange(changes, {
      kind: "set-settings",
      values: { b: 2, c: 3 },
    });
    expect(changes).toEqual([
      { kind: "update-note", path: ["Welcome"], content: "v1" },
      { kind: "set-settings", values: { a: 1, b: 2, c: 3 } },
    ]);
  });

  it("keeps note changes in order around a single set-settings", () => {
    let changes: ChangeSet = [];
    changes = appendChange(changes, { kind: "create-folder", path: ["X"] });
    changes = appendChange(changes, { kind: "set-settings", values: { a: 1 } });
    changes = appendChange(changes, { kind: "delete-note", path: ["Welcome"] });
    changes = appendChange(changes, { kind: "set-settings", values: { a: 2 } });
    expect(changes).toEqual([
      { kind: "create-folder", path: ["X"] },
      { kind: "delete-note", path: ["Welcome"] },
      { kind: "set-settings", values: { a: 2 } },
    ]);
  });

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

  it("replaces an earlier pending position of the same item", () => {
    const changes: ChangeSet = [
      {
        kind: "set-order",
        parent: [],
        positions: [
          { name: "Welcome", key: "1" },
          { name: "Docs", key: "2" },
        ],
      },
      { kind: "update-note", path: ["Welcome"], content: "edited" },
      { kind: "set-order", parent: ["Docs"], positions: [{ name: "Guide", key: "1" }] },
    ];
    const result = appendChange(changes, {
      kind: "set-order",
      parent: [],
      positions: [{ name: "Welcome", key: "3" }],
    });
    expect(result).toEqual([
      { kind: "set-order", parent: [], positions: [{ name: "Docs", key: "2" }] },
      changes[1],
      changes[2],
      { kind: "set-order", parent: [], positions: [{ name: "Welcome", key: "3" }] },
    ]);
  });

  it("removes an earlier pending set-order once all its positions are replaced", () => {
    const result = appendChange(
      [{ kind: "set-order", parent: [], positions: [{ name: "Welcome", key: "1" }] }],
      { kind: "set-order", parent: [], positions: [{ name: "Welcome", key: "2" }] },
    );
    expect(result).toEqual([
      { kind: "set-order", parent: [], positions: [{ name: "Welcome", key: "2" }] },
    ]);
  });

  it("keeps an earlier position when a structural change lies in between", () => {
    const changes: ChangeSet = [
      { kind: "set-order", parent: [], positions: [{ name: "Welcome", key: "1" }] },
      { kind: "rename-note", from: ["Welcome"], to: ["Hello"] },
      { kind: "create-note", path: ["Welcome"], content: "" },
    ];
    const next: Change = {
      kind: "set-order",
      parent: [],
      positions: [{ name: "Welcome", key: "2" }],
    };
    expect(appendChange(changes, next)).toEqual([...changes, next]);
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

describe("rebaseChanges set-settings", () => {
  it("keeps a set-settings change unchanged", () => {
    const settings: Change = { kind: "set-settings", values: { a: 1 } };
    expect(
      rebaseChanges(
        SAMPLE_TREE,
        [{ kind: "delete-note", path: ["Welcome"] }],
        [settings],
      ),
    ).toEqual({ changes: [settings], dropped: [] });
  });
});

describe("rebaseChanges set-order", () => {
  it("keeps only the positions of items that still exist, without reporting the rest", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [{ kind: "delete-note", path: ["Welcome"] }],
      [
        {
          kind: "set-order",
          parent: [],
          positions: [
            { name: "Welcome", key: "1" },
            { name: "Docs", key: "2" },
          ],
        },
      ],
    );
    expect(result).toEqual({
      changes: [
        { kind: "set-order", parent: [], positions: [{ name: "Docs", key: "2" }] },
      ],
      dropped: [],
    });
  });

  it("drops positions in a folder that no longer exists, without reporting them", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [{ kind: "rename-folder", from: ["Docs"], to: ["Manuals"] }],
      [
        {
          kind: "set-order",
          parent: ["Docs"],
          positions: [{ name: "Guide", key: "1" }],
        },
      ],
    );
    expect(result).toEqual({ changes: [], dropped: [] });
  });
});

function tagsOf(notes: Record<string, string>): TagIndex {
  return parseTagIndex(
    JSON.stringify({
      version: 1,
      notes: Object.fromEntries(
        Object.entries(notes).map(([key, color]) => [key, { color }]),
      ),
      trash: {},
    }),
  );
}

const TAGGED = tagsOf({
  [tagKey(["Welcome"])]: "red",
  [tagKey(["Docs", "Notes", "Todo"])]: "blue",
});

function colorAt(
  changes: ChangeSet,
  path: NotePath,
  tags: TagIndex = TAGGED,
): unknown {
  const node = findWorkingNode(
    buildWorkingTree(SAMPLE_TREE, changes, [], undefined, tags),
    path,
  );
  return node?.kind === "note" ? node.colorTag : undefined;
}

describe("buildWorkingTree color tags", () => {
  it("takes note colors from the synced tag index", () => {
    expect(colorAt([], ["Welcome"])).toBe("red");
    expect(colorAt([], ["Docs", "Guide"])).toBeNull();
  });

  it("shows a pending set-color-tag optimistically", () => {
    expect(
      colorAt(
        [{ kind: "set-color-tag", path: ["Docs", "Guide"], color: "green" }],
        ["Docs", "Guide"],
      ),
    ).toBe("green");
    expect(
      colorAt(
        [{ kind: "set-color-tag", path: ["Welcome"], color: null }],
        ["Welcome"],
      ),
    ).toBeNull();
  });

  it("keeps the color of a renamed note at its new path", () => {
    expect(
      colorAt(
        [{ kind: "rename-note", from: ["Welcome"], to: ["Docs", "Hello"] }],
        ["Docs", "Hello"],
      ),
    ).toBe("red");
  });

  it("keeps nested colors when a folder moves", () => {
    expect(
      colorAt(
        [{ kind: "rename-folder", from: ["Docs"], to: ["Empty", "Manuals"] }],
        ["Empty", "Manuals", "Notes", "Todo"],
      ),
    ).toBe("blue");
  });

  it("exposes the resulting tag index on the working state", () => {
    const state = buildWorkingState(
      SAMPLE_TREE,
      [{ kind: "set-color-tag", path: ["Docs", "Guide"], color: "green" }],
      [],
      undefined,
      TAGGED,
    );
    expect(state.tags.notes.get(tagKey(["Docs", "Guide"]))).toEqual({
      color: "green",
    });
  });

  it("rejects a set-color-tag for a path that is not a note", () => {
    expect(() =>
      buildWorkingTree(SAMPLE_TREE, [
        { kind: "set-color-tag", path: ["Missing"], color: "red" },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      buildWorkingTree(SAMPLE_TREE, [
        { kind: "set-color-tag", path: ["Docs"], color: "red" },
      ]),
    ).toThrow(RangeError);
  });
});

function trashedNoteColors(
  trash: readonly WorkingTrashEntry[],
): Record<string, unknown> {
  const colors: Record<string, unknown> = {};
  function visit(node: WorkingNode): void {
    if (node.kind === "note") colors[node.path.join("/")] = node.colorTag;
    else node.children.forEach(visit);
  }
  for (const entry of trash) if (!entry.undecryptable) visit(entry.tree);
  return colors;
}

const TRASH_TAGGED = parseTagIndex(
  JSON.stringify({
    version: 1,
    notes: {},
    trash: {
      [OLD_NOTE_ID]: { [tagKey([])]: { color: "green" } },
      [OLD_FOLDER_ID]: { [tagKey(["Inner", "Deep"])]: { color: "purple" } },
    },
  }),
);

describe("buildWorkingState trash color tags", () => {
  it("colors synced trashed notes, nested ones included, by their entry's records", () => {
    const { trash } = buildWorkingState(
      SAMPLE_TREE,
      [],
      SYNCED_TRASH,
      undefined,
      TRASH_TAGGED,
    );

    expect(trashedNoteColors(trash)).toEqual({
      "Archive/Old": "green",
      "Trashed/Inner/Deep": "purple",
      "Trashed/Top": null,
    });
  });

  it("carries a pending trashed note's color into its entry and back on restore", () => {
    const trashed: Change[] = [
      { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
    ];
    const afterTrash = buildWorkingState(
      SAMPLE_TREE,
      trashed,
      [],
      undefined,
      TAGGED,
    );
    expect(trashedNoteColors(afterTrash.trash)).toEqual({ Welcome: "red" });

    expect(
      colorAt(
        [
          ...trashed,
          {
            kind: "restore-trash",
            entryId: WELCOME_ID,
            subPath: [],
            target: "note",
            to: ["Docs", "Welcome"],
          },
        ],
        ["Docs", "Welcome"],
      ),
    ).toBe("red");
  });

  it("colors notes inside a pending trashed folder relative to the trashed folder", () => {
    const { trash } = buildWorkingState(
      SAMPLE_TREE,
      [{ kind: "trash-folder", path: ["Docs"], entryId: DOCS_ID }],
      [],
      undefined,
      TAGGED,
    );

    expect(trashedNoteColors(trash)).toEqual({
      "Docs/Guide": null,
      "Docs/Notes/Todo": "blue",
    });
  });

  it("keeps the colors of what is left in a folder entry after a partial restore", () => {
    const { trash } = buildWorkingState(
      SAMPLE_TREE,
      [
        {
          kind: "restore-trash",
          entryId: OLD_FOLDER_ID,
          subPath: ["Top"],
          target: "note",
          to: ["Top"],
        },
      ],
      SYNCED_TRASH,
      undefined,
      TRASH_TAGGED,
    );

    expect(trashedNoteColors(trash)).toEqual({
      "Archive/Old": "green",
      "Trashed/Inner/Deep": "purple",
    });
  });

  it("shows no trash colors when the tag index can't be read", () => {
    const unreadable = parseTagIndex("not json");
    expect(unreadable.writable).toBe(false);
    const { trash } = buildWorkingState(
      SAMPLE_TREE,
      [
        { kind: "set-color-tag", path: ["Welcome"], color: "red" },
        { kind: "trash-note", path: ["Welcome"], entryId: WELCOME_ID },
      ],
      SYNCED_TRASH,
      undefined,
      unreadable,
    );

    expect(trashedNoteColors(trash)).toEqual({
      "Archive/Old": null,
      "Trashed/Inner/Deep": null,
      "Trashed/Top": null,
      Welcome: null,
    });
  });
});

describe("appendChange set-color-tag", () => {
  it("replaces an earlier tag of the same note across interleaved edits", () => {
    let changes: ChangeSet = [];
    changes = appendChange(changes, {
      kind: "set-color-tag",
      path: ["Welcome"],
      color: "red",
    });
    changes = appendChange(changes, {
      kind: "update-note",
      path: ["Docs", "Guide"],
      content: "v2",
    });
    changes = appendChange(changes, {
      kind: "set-color-tag",
      path: ["Welcome"],
      color: "blue",
    });
    expect(changes).toEqual([
      { kind: "update-note", path: ["Docs", "Guide"], content: "v2" },
      { kind: "set-color-tag", path: ["Welcome"], color: "blue" },
    ]);
  });

  it("keeps tags of different notes", () => {
    const changes = appendChange(
      [{ kind: "set-color-tag", path: ["Welcome"], color: "red" }],
      { kind: "set-color-tag", path: ["Docs", "Guide"], color: "green" },
    );
    expect(changes).toEqual([
      { kind: "set-color-tag", path: ["Welcome"], color: "red" },
      { kind: "set-color-tag", path: ["Docs", "Guide"], color: "green" },
    ]);
  });

  it("does not collapse across a rename of the note", () => {
    const changes: ChangeSet = [
      { kind: "set-color-tag", path: ["Welcome"], color: "red" },
      { kind: "rename-note", from: ["Welcome"], to: ["Hello"] },
      { kind: "rename-note", from: ["Hello"], to: ["Welcome"] },
    ];
    expect(
      appendChange(changes, {
        kind: "set-color-tag",
        path: ["Welcome"],
        color: "blue",
      }),
    ).toEqual([
      ...changes,
      { kind: "set-color-tag", path: ["Welcome"], color: "blue" },
    ]);
  });
});

describe("rebaseChanges set-color-tag", () => {
  it("keeps a tag of a note that still exists", () => {
    const change: Change = {
      kind: "set-color-tag",
      path: ["Welcome"],
      color: "red",
    };
    expect(rebaseChanges(SAMPLE_TREE, [], [change])).toEqual({
      changes: [change],
      dropped: [],
    });
  });

  it("follows a remote rename when the remote base is given", () => {
    const base = tree(
      folder("", [], [note("Welcome", ["Welcome"], "sha-1"), note("Other", ["Other"])]),
    );
    const remote = tree(
      folder(
        "",
        [],
        [
          folder("Docs", ["Docs"], [note("Hello", ["Docs", "Hello"], "sha-1")]),
          note("Other", ["Other"]),
        ],
      ),
    );
    const result = rebaseChanges(
      remote,
      [],
      [{ kind: "set-color-tag", path: ["Welcome"], color: "red" }],
      [],
      base,
    );
    expect(result).toEqual({
      changes: [{ kind: "set-color-tag", path: ["Docs", "Hello"], color: "red" }],
      dropped: [],
    });
  });

  it("silently drops a tag of a note that is gone", () => {
    const result = rebaseChanges(
      SAMPLE_TREE,
      [{ kind: "delete-note", path: ["Welcome"] }],
      [{ kind: "set-color-tag", path: ["Welcome"], color: "red" }],
      [],
      SAMPLE_TREE,
    );
    expect(result).toEqual({ changes: [], dropped: [] });
  });
});
