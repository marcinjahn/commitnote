import { describe, expect, it } from "vitest";
import type { TrashEntry } from "../trash/trash-index";
import type { NoteTree } from "../tree/note-tree";
import {
  findTrashItem,
  findWorkingTrashEntry,
  type ReadableWorkingTrashEntry,
} from "./working-trash";
import { buildWorkingState } from "./working-tree";

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
