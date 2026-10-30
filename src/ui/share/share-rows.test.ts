import { describe, expect, it } from "vitest";
import type { ShareEntry } from "../../share/share-index";
import type {
  WorkingFolder,
  WorkingNode,
  WorkingNote,
  WorkingTree,
} from "../../sync/working-tree";
import { canOpenShare, latestShareDate } from "./share-rows";

function entry(overrides: Partial<ShareEntry> = {}): ShareEntry {
  return {
    id: "s1",
    locator: { provider: "github", gistId: "g1" },
    linkSecret: "secret",
    password: null,
    name: "Stored",
    label: null,
    sharedAt: "2026-01-01T00:00:00.000Z",
    note: { state: "active", path: ["Folder", "Live"] },
    source: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("latestShareDate", () => {
  it("uses sharedAt when never updated", () => {
    expect(latestShareDate(entry())).toBe("2026-01-01T00:00:00.000Z");
  });

  it("uses updatedAt when newer than sharedAt", () => {
    expect(latestShareDate(entry({ updatedAt: "2026-02-01T00:00:00.000Z" }))).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("uses sharedAt when updatedAt is older", () => {
    expect(latestShareDate(entry({ updatedAt: "2025-12-01T00:00:00.000Z" }))).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});

describe("canOpenShare", () => {
  it("opens an active note when the tree is unknown", () => {
    expect(canOpenShare(entry(), null)).toBe(true);
  });

  it("does not open a trashed or deleted note", () => {
    const trashed = entry({ note: { state: "trashed", entryId: "t1", path: ["Old"] } });
    expect(canOpenShare(trashed, null)).toBe(false);
    expect(canOpenShare(entry({ note: { state: "deleted" } }), null)).toBe(false);
  });

  it("does not open a note missing from the tree", () => {
    const folder = (name: string, children: WorkingNode[]): WorkingFolder => ({
      kind: "folder",
      name,
      path: [],
      children,
    });
    const tree: WorkingTree = { root: folder("", [folder("Folder", [])]) };
    expect(canOpenShare(entry(), tree)).toBe(false);
  });

  it("opens a note present in the tree", () => {
    const note: WorkingNote = {
      kind: "note",
      name: "Live",
      path: ["Folder", "Live"],
      syncedPath: null,
      colorTag: null,
      shared: true,
    };
    const tree: WorkingTree = {
      root: {
        kind: "folder",
        name: "",
        path: [],
        children: [
          { kind: "folder", name: "Folder", path: ["Folder"], children: [note] },
        ],
      },
    };
    expect(canOpenShare(entry(), tree)).toBe(true);
  });
});
