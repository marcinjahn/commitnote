import { describe, expect, it } from "vitest";
import type { Change, ChangeSet, NotePath } from "../changes/change";
import {
  computeSyncStates,
  hasConflictMarkers,
  removeConflictMarkerLines,
  SYNCED,
} from "./sync-state";

function pathOf(...segments: string[]): NotePath {
  return segments;
}

describe("computeSyncStates entry paths", () => {
  const cases: ReadonlyArray<{
    readonly description: string;
    readonly change: Change;
    readonly expectedPath: NotePath;
  }> = [
    {
      description: "create-note marks its path",
      change: { kind: "create-note", path: pathOf("a.md"), content: "" },
      expectedPath: pathOf("a.md"),
    },
    {
      description: "update-note marks its path",
      change: { kind: "update-note", path: pathOf("a.md"), content: "" },
      expectedPath: pathOf("a.md"),
    },
    {
      description: "create-folder marks its path",
      change: { kind: "create-folder", path: pathOf("folder") },
      expectedPath: pathOf("folder"),
    },
    {
      description: "rename-note marks the destination path",
      change: {
        kind: "rename-note",
        from: pathOf("a.md"),
        to: pathOf("b.md"),
      },
      expectedPath: pathOf("b.md"),
    },
    {
      description: "rename-folder marks the destination path",
      change: { kind: "rename-folder", from: pathOf("f1"), to: pathOf("f2") },
      expectedPath: pathOf("f2"),
    },
    {
      description: "delete-note marks the parent folder",
      change: { kind: "delete-note", path: pathOf("folder", "a.md") },
      expectedPath: pathOf("folder"),
    },
    {
      description: "delete-folder marks the parent folder",
      change: { kind: "delete-folder", path: pathOf("folder", "sub") },
      expectedPath: pathOf("folder"),
    },
    {
      description: "delete-note at the root marks the root",
      change: { kind: "delete-note", path: pathOf("a.md") },
      expectedPath: [],
    },
    {
      description: "delete-folder at the root marks the root",
      change: { kind: "delete-folder", path: pathOf("folder") },
      expectedPath: [],
    },
    {
      description: "trash-note marks the parent folder",
      change: {
        kind: "trash-note",
        path: pathOf("folder", "a.md"),
        entryId: "20260930T100000Z-2-aaaaaaaa",
      },
      expectedPath: pathOf("folder"),
    },
    {
      description: "trash-folder at the root marks the root",
      change: {
        kind: "trash-folder",
        path: pathOf("folder"),
        entryId: "20260930T100000Z-1-aaaaaaaa",
      },
      expectedPath: [],
    },
    {
      description: "restore-trash marks the restore target",
      change: {
        kind: "restore-trash",
        entryId: "20260930T100000Z-1-aaaaaaaa",
        subPath: [],
        target: "folder",
        to: pathOf("parent", "restored"),
      },
      expectedPath: pathOf("parent", "restored"),
    },
    {
      description: "set-order marks the folder whose children it positions",
      change: {
        kind: "set-order",
        parent: pathOf("folder"),
        positions: [{ name: "a.md", key: "V" }],
      },
      expectedPath: pathOf("folder"),
    },
  ];

  it.each(cases)("$description", ({ change, expectedPath }) => {
    const states = computeSyncStates({
      pending: [change],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    expect(states.stateOf(expectedPath)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });
    expect(states.unsavedCount).toBe(1);
  });
});

describe("computeSyncStates order", () => {
  const position = (parent: NotePath): Extract<Change, { kind: "set-order" }> => ({
    kind: "set-order",
    parent,
    positions: [{ name: "a.md", key: "V" }],
  });

  it("counts a new position in a folder with nothing else unsaved", () => {
    const states = computeSyncStates({
      pending: [position(pathOf("f")), position(pathOf("g"))],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    expect(states.unsavedCount).toBe(2);
  });

  it("doesn't count the position of a new or moved item on top of the item itself", () => {
    const states = computeSyncStates({
      pending: [
        { kind: "create-note", path: pathOf("f", "a.md"), content: "" },
        position(pathOf("f")),
        { kind: "rename-note", from: pathOf("b.md"), to: pathOf("g", "b.md") },
        position(pathOf("g")),
      ],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    expect(states.unsavedCount).toBe(2);
  });

  it("marks only the moved item of a reorder, not the siblings positioned with it", () => {
    const states = computeSyncStates({
      pending: [],
      inFlight: [
        {
          kind: "set-order",
          parent: pathOf("f"),
          positions: [
            { name: "a.md", key: "F" },
            { name: "b.md", key: "N" },
            { name: "c.md", key: "V" },
          ],
          moved: "b.md",
        },
      ],
      failed: false,
      conflicts: [],
    });

    expect(states.stateOf(pathOf("f", "b.md"))).toEqual({ kind: "syncing" });
    expect(states.stateOf(pathOf("f"))).toEqual({ kind: "syncing" });
    expect(states.stateOf([])).toEqual({ kind: "syncing" });
    expect(states.stateOf(pathOf("f", "a.md"))).toBe(SYNCED);
    expect(states.stateOf(pathOf("f", "c.md"))).toBe(SYNCED);
    expect(states.unsavedCount).toBe(1);
  });

  it("marks an item reordered at the top level", () => {
    const states = computeSyncStates({
      pending: [{ ...position([]), moved: "a.md" }],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    expect(states.stateOf(pathOf("a.md"))).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });
    expect(states.unsavedCount).toBe(1);
  });

  it("counts an item moved into a folder and placed there once", () => {
    const states = computeSyncStates({
      pending: [
        { kind: "rename-note", from: pathOf("b.md"), to: pathOf("g", "b.md") },
        { ...position(pathOf("g")), moved: "b.md" },
      ],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    expect(states.unsavedCount).toBe(1);
  });

  it("counts a reordered item once while its earlier position is in flight", () => {
    const reorder: Change = { ...position(pathOf("f")), moved: "a.md" };
    const states = computeSyncStates({
      pending: [reorder],
      inFlight: [reorder],
      failed: false,
      conflicts: [],
    });

    expect(states.unsavedCount).toBe(1);
  });
});

describe("computeSyncStates purge", () => {
  it("never counts a purge as unsaved, pending or in flight", () => {
    const purge = {
      kind: "purge-trash",
      entryIds: ["20260901T080000Z-1-aaaaaaaa"],
    } as const;
    const states = computeSyncStates({
      pending: [purge],
      inFlight: [purge],
      failed: true,
      conflicts: [],
    });

    expect(states.stateOf([])).toBe(SYNCED);
    expect(states.unsavedCount).toBe(0);
    expect(states.hasUnsaved).toBe(false);
  });
});

describe("computeSyncStates precedence", () => {
  it("returns synced with no entries anywhere", () => {
    const states = computeSyncStates({
      pending: [],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    expect(states.stateOf([])).toBe(SYNCED);
    expect(states.stateOf(pathOf("anything"))).toBe(SYNCED);
    expect(states.unsavedCount).toBe(0);
    expect(states.hasUnsaved).toBe(false);
  });

  it("marks an in-flight-only path as syncing", () => {
    const path = pathOf("a.md");
    const states = computeSyncStates({
      pending: [],
      inFlight: [{ kind: "update-note", path, content: "y" }],
      failed: false,
      conflicts: [],
    });

    expect(states.stateOf(path)).toEqual({ kind: "syncing" });
  });

  it("has pending win over syncing for a path in both lists", () => {
    const path = pathOf("a.md");
    const states = computeSyncStates({
      pending: [{ kind: "update-note", path, content: "x" }],
      inFlight: [{ kind: "update-note", path, content: "y" }],
      failed: false,
      conflicts: [],
    });

    expect(states.stateOf(path)).toEqual({
      kind: "out-of-sync",
      reason: "pending",
    });
    expect(states.unsavedCount).toBe(1);
  });

  it("turns both pending and in-flight entries into failed when failed is true", () => {
    const pendingPath = pathOf("a.md");
    const inFlightPath = pathOf("b.md");
    const states = computeSyncStates({
      pending: [{ kind: "update-note", path: pendingPath, content: "x" }],
      inFlight: [{ kind: "update-note", path: inFlightPath, content: "y" }],
      failed: true,
      conflicts: [],
    });

    expect(states.stateOf(pendingPath)).toEqual({
      kind: "out-of-sync",
      reason: "failed",
    });
    expect(states.stateOf(inFlightPath)).toEqual({
      kind: "out-of-sync",
      reason: "failed",
    });
  });

  it("has conflict outrank failed, pending and syncing on the same path", () => {
    const path = pathOf("a.md");
    const states = computeSyncStates({
      pending: [{ kind: "update-note", path, content: "x" }],
      inFlight: [{ kind: "update-note", path, content: "y" }],
      failed: true,
      conflicts: [path],
    });

    expect(states.stateOf(path)).toEqual({
      kind: "out-of-sync",
      reason: "conflict",
    });
    expect(states.unsavedCount).toBe(1);
  });

  it("marks a held conflict with no other entry as out-of-sync/conflict", () => {
    const path = pathOf("a.md");
    const states = computeSyncStates({
      pending: [],
      inFlight: [],
      failed: false,
      conflicts: [path],
    });

    expect(states.stateOf(path)).toEqual({
      kind: "out-of-sync",
      reason: "conflict",
    });
  });
});

describe("computeSyncStates folder roll-up", () => {
  it("rolls a nested entry's state up to every ancestor and the root, leaving a sibling folder synced", () => {
    const path = pathOf("folder", "sub", "note.md");
    const states = computeSyncStates({
      pending: [{ kind: "update-note", path, content: "x" }],
      inFlight: [],
      failed: false,
      conflicts: [],
    });

    const expectedPending = { kind: "out-of-sync", reason: "pending" };
    expect(states.stateOf(path)).toEqual(expectedPending);
    expect(states.stateOf(pathOf("folder", "sub"))).toEqual(expectedPending);
    expect(states.stateOf(pathOf("folder"))).toEqual(expectedPending);
    expect(states.stateOf([])).toEqual(expectedPending);

    expect(states.stateOf(pathOf("other"))).toBe(SYNCED);
    expect(states.stateOf(pathOf("other", "child.md"))).toBe(SYNCED);
  });
});

describe("computeSyncStates unsavedCount", () => {
  it("deduplicates entry paths shared across pending, in-flight and conflicts", () => {
    const shared = pathOf("a.md");
    const onlyPending = pathOf("b.md");
    const onlyConflict = pathOf("c.md");

    const pending: ChangeSet = [
      { kind: "update-note", path: shared, content: "x" },
      { kind: "update-note", path: onlyPending, content: "y" },
    ];
    const inFlight: ChangeSet = [
      { kind: "update-note", path: shared, content: "z" },
    ];

    const states = computeSyncStates({
      pending,
      inFlight,
      failed: false,
      conflicts: [shared, onlyConflict],
    });

    expect(states.unsavedCount).toBe(3);
    expect(states.hasUnsaved).toBe(true);
  });
});

describe("hasConflictMarkers", () => {
  it("is true for the mine marker line", () => {
    expect(hasConflictMarkers("<<<<<<< mine")).toBe(true);
  });

  it("is true for the separator marker line", () => {
    expect(hasConflictMarkers("=======")).toBe(true);
  });

  it("is true for the theirs marker line", () => {
    expect(hasConflictMarkers(">>>>>>> theirs")).toBe(true);
  });

  it("is false when a marker is embedded mid-line rather than being the whole line", () => {
    expect(hasConflictMarkers("well, <<<<<<< mine actually")).toBe(false);
    expect(hasConflictMarkers("nothing here")).toBe(false);
  });

  it("is true for CRLF text with a marker line", () => {
    const text = [
      "before\r",
      "<<<<<<< mine\r",
      "mine text\r",
      "=======\r",
      "their text\r",
      ">>>>>>> theirs\r",
      "after\r",
    ].join("\n");

    expect(hasConflictMarkers(text)).toBe(true);
  });
});

describe("removeConflictMarkerLines", () => {
  it("drops the marker lines and keeps both hunk sides and surrounding lines in order", () => {
    const text = [
      "before",
      "<<<<<<< mine\r",
      "my side",
      "=======",
      "their side",
      ">>>>>>> theirs",
      "after",
    ].join("\n");

    expect(removeConflictMarkerLines(text)).toBe(
      ["before", "my side", "their side", "after"].join("\n"),
    );
  });

  it("returns text without markers unchanged", () => {
    const text = "one\r\ntwo <<<<<<< mine\n\nthree\n";
    expect(removeConflictMarkerLines(text)).toBe(text);
  });
});
