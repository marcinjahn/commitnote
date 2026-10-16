import { describe, expect, it } from "vitest";
import type { TrashEntry } from "../trash/trash-index";
import type { NoteTree } from "../tree/note-tree";
import {
  findTrashItem,
  findWorkingTrashEntry,
  findWorkingTrashedLocation,
  type ReadableWorkingTrashEntry,
  type WorkingTrashEntry,
} from "./working-trash";
import { buildWorkingState, type WorkingNote } from "./working-tree";

const buildWorkingTrash = (
  ...args: Parameters<typeof buildWorkingState>
) => buildWorkingState(...args).trash;

const SYNCED_ID = "20260901T080000Z-1-aaaaaaaa";
const PENDING_ID = "20260930T100000Z-1-bbbbbbbb";

const TREE: NoteTree = {
  root: {
    kind: "folder",
    name: "",
    path: [],
    storedPath: "",
    children: [
      {
        kind: "note",
        name: "Welcome",
        path: ["Welcome"],
        storedPath: "w",
        blobSha: "sha-welcome",
      },
    ],
  },
};

const SYNCED_TRASH: readonly TrashEntry[] = [
  {
    id: SYNCED_ID,
    deletedAt: Date.UTC(2026, 8, 1, 8, 0, 0),
    files: [],
    undecryptable: false,
    kind: "folder",
    originalPath: ["Old"],
    storedRoot: "o",
    tree: {
      kind: "folder",
      name: "Old",
      path: ["Old"],
      storedPath: "o",
      children: [
        {
          kind: "folder",
          name: "Sub",
          path: ["Old", "Sub"],
          storedPath: "o/s",
          children: [
            {
              kind: "note",
              name: "Leaf",
              path: ["Old", "Sub", "Leaf"],
              storedPath: "o/s/l",
              blobSha: "sha-leaf",
            },
          ],
        },
      ],
    },
  },
];

function readable(
  entry: ReturnType<typeof findWorkingTrashEntry>,
): ReadableWorkingTrashEntry {
  if (entry === undefined || entry.undecryptable) {
    throw new Error("expected a readable entry");
  }
  return entry;
}

describe("working trash", () => {
  it("combines synced entries with ones trashed by local changes", () => {
    const trash = buildWorkingTrash(
      TREE,
      [{ kind: "trash-note", path: ["Welcome"], entryId: PENDING_ID }],
      SYNCED_TRASH,
    );

    expect(
      trash.map((entry) => [entry.id, entry.synced, entry.deletedAt]),
    ).toEqual([
      [SYNCED_ID, true, Date.UTC(2026, 8, 1, 8, 0, 0)],
      [PENDING_ID, false, Date.UTC(2026, 8, 30, 10, 0, 0)],
    ]);
  });

  it("drops a whole entry once it is restored and keeps it for a partial restore", () => {
    const whole = buildWorkingTrash(
      TREE,
      [
        {
          kind: "restore-trash",
          entryId: SYNCED_ID,
          subPath: [],
          target: "folder",
          to: ["Old"],
        },
      ],
      SYNCED_TRASH,
    );
    const partial = buildWorkingTrash(
      TREE,
      [
        {
          kind: "restore-trash",
          entryId: SYNCED_ID,
          subPath: ["Sub", "Leaf"],
          target: "note",
          to: ["Leaf"],
        },
      ],
      SYNCED_TRASH,
    );

    expect(whole).toEqual([]);
    const entry = readable(findWorkingTrashEntry(partial, SYNCED_ID));
    expect(findTrashItem(entry, ["Sub"])).toEqual({
      kind: "folder",
      name: "Sub",
      path: ["Old", "Sub"],
      children: [],
    });
  });
});

describe("findTrashItem", () => {
  const entry = readable(
    findWorkingTrashEntry(buildWorkingTrash(TREE, [], SYNCED_TRASH), SYNCED_ID),
  );

  it("returns the trashed item itself for an empty sub-path", () => {
    expect(findTrashItem(entry, [])).toBe(entry.tree);
  });

  it("finds a nested item by its path relative to the trashed item", () => {
    expect(findTrashItem(entry, ["Sub", "Leaf"])).toEqual({
      kind: "note",
      name: "Leaf",
      path: ["Old", "Sub", "Leaf"],
      syncedPath: null,
      colorTag: null,
      shared: false,
      trashBlobSha: "sha-leaf",
    });
  });

  it("returns undefined for a missing item or a path through a note", () => {
    expect(findTrashItem(entry, ["Nope"])).toBeUndefined();
    expect(findTrashItem(entry, ["Sub", "Leaf", "More"])).toBeUndefined();
  });
});

describe("findWorkingTrashEntry", () => {
  it("returns undefined for an unknown id", () => {
    expect(
      findWorkingTrashEntry(
        buildWorkingTrash(TREE, [], SYNCED_TRASH),
        PENDING_ID,
      ),
    ).toBeUndefined();
  });
});

describe("findWorkingTrashedLocation", () => {
  const note = (path: string[]): WorkingNote => ({
    kind: "note",
    name: path[path.length - 1],
    path,
    syncedPath: null,
    colorTag: null,
    shared: false,
  });

  const noteEntry = (
    id: string,
    deletedAt: number,
    path: string[],
  ): ReadableWorkingTrashEntry => ({
    id,
    deletedAt,
    undecryptable: false,
    synced: true,
    kind: "note",
    originalPath: path,
    tree: note(path),
  });

  const folderEntry: ReadableWorkingTrashEntry = {
    id: SYNCED_ID,
    deletedAt: 100,
    undecryptable: false,
    synced: true,
    kind: "folder",
    originalPath: ["Old"],
    tree: {
      kind: "folder",
      name: "Old",
      path: ["Old"],
      children: [
        {
          kind: "folder",
          name: "Sub",
          path: ["Old", "Sub"],
          children: [note(["Old", "Sub", "Leaf"])],
        },
      ],
    },
  };

  it("finds a trashed note by its original path", () => {
    expect(
      findWorkingTrashedLocation(
        [noteEntry(PENDING_ID, 100, ["Welcome"])],
        ["Welcome"],
      ),
    ).toEqual({ entryId: PENDING_ID, entryKind: "note" });
  });

  it("finds a note nested in a trashed folder", () => {
    expect(
      findWorkingTrashedLocation([folderEntry], ["Old", "Sub", "Leaf"]),
    ).toEqual({ entryId: SYNCED_ID, entryKind: "folder" });
  });

  it("returns null when a trashed folder does not hold the note", () => {
    expect(findWorkingTrashedLocation([folderEntry], ["Old", "Gone"])).toBeNull();
    expect(findWorkingTrashedLocation([folderEntry], ["Old", "Sub"])).toBeNull();
    expect(findWorkingTrashedLocation([folderEntry], ["Old"])).toBeNull();
  });

  it("skips undecryptable entries", () => {
    const undecryptable: WorkingTrashEntry = {
      id: "20261001T100000Z-1-dddddddd",
      deletedAt: 200,
      undecryptable: true,
      synced: true,
    };
    expect(
      findWorkingTrashedLocation(
        [undecryptable, noteEntry(PENDING_ID, 100, ["Welcome"])],
        ["Welcome"],
      ),
    ).toEqual({ entryId: PENDING_ID, entryKind: "note" });
  });

  it("prefers the most recently deleted entry", () => {
    const olderId = "20260801T100000Z-3-cccccccc";
    const older = noteEntry(olderId, 100, ["Old", "Sub", "Leaf"]);
    const newer = { ...folderEntry, id: PENDING_ID, deletedAt: 200 };
    expect(
      findWorkingTrashedLocation([newer, older], ["Old", "Sub", "Leaf"]),
    ).toEqual({ entryId: PENDING_ID, entryKind: "folder" });
    expect(
      findWorkingTrashedLocation(
        [{ ...folderEntry, deletedAt: 50 }, older],
        ["Old", "Sub", "Leaf"],
      ),
    ).toEqual({ entryId: olderId, entryKind: "note" });
  });

  it("returns null when nothing in the trash matches", () => {
    expect(findWorkingTrashedLocation([], ["Welcome"])).toBeNull();
  });
});
