import { describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import type { CommitSummary } from "../forge/forge-adapter";
import type { TrashEntry } from "../trash/trash-index";
import type { FolderNode, NoteTree, TreeNode } from "../tree/note-tree";
import { locateRemoteRelocation } from "./remote-relocation";

function treeOf(notes: Record<string, string>): NoteTree {
  const root: FolderNode = {
    kind: "folder",
    name: "",
    path: [],
    storedPath: "",
    children: [],
  };
  const folders = new Map<string, TreeNode[]>();
  const rootChildren: TreeNode[] = [];
  folders.set("", rootChildren);
  const ensure = (path: string[]): TreeNode[] => {
    const key = path.join("/");
    const existing = folders.get(key);
    if (existing) return existing;
    const parent = ensure(path.slice(0, -1));
    const children: TreeNode[] = [];
    folders.set(key, children);
    parent.push({
      kind: "folder",
      name: path[path.length - 1],
      path,
      storedPath: key,
      children,
    });
    return children;
  };
  for (const [path, sha] of Object.entries(notes)) {
    const segments = path.split("/");
    ensure(segments.slice(0, -1)).push({
      kind: "note",
      name: segments[segments.length - 1],
      path: segments,
      storedPath: path,
      blobSha: sha,
    });
  }
  return { root: { ...root, children: rootChildren } };
}

const at = (path: string): NotePath => path.split("/");

function commit(...trailers: string[]): CommitSummary {
  return {
    sha: "c1",
    parents: ["c0"],
    message: ["Rename", "", "Commitnote-Format: 1", ...trailers].join("\n"),
    committedAt: 0,
  };
}

function locate(
  previous: Record<string, string>,
  next: Record<string, string>,
  path: string,
  listCommits = vi.fn().mockResolvedValue([]),
  newTrash: TrashEntry[] = [],
) {
  return locateRemoteRelocation({
    previousTree: treeOf(previous),
    newTree: treeOf(next),
    newHead: "head",
    newTrash,
    path: at(path),
    listCommits,
  });
}

describe("locateRemoteRelocation", () => {
  it("finds a renamed note by blob sha", async () => {
    expect(await locate({ "a.md": "s1" }, { "b.md": "s1" }, "a.md")).toEqual([
      "b.md",
    ]);
  });

  it("finds a note moved to another folder", async () => {
    expect(await locate({ "a.md": "s1" }, { "f/a.md": "s1" }, "a.md")).toEqual([
      "f",
      "a.md",
    ]);
  });

  it("follows a renamed folder", async () => {
    expect(
      await locate(
        { "old/a.md": "s1", "old/b.md": "s2" },
        { "new/a.md": "s1", "new/b.md": "s2" },
        "old/a.md",
      ),
    ).toEqual(["new", "a.md"]);
  });

  it("falls through to the trailer when the blob sha is ambiguous", async () => {
    const listCommits = vi
      .fn()
      .mockResolvedValue([commit("Commitnote-Rename: a.md -> b.md")]);
    expect(
      await locate(
        { "a.md": "s1" },
        { "b.md": "s1", "c.md": "s1" },
        "a.md",
        listCommits,
      ),
    ).toEqual(["b.md"]);
    expect(listCommits).toHaveBeenCalledWith({
      from: "head",
      path: "a.md",
      limit: 1,
    });
  });

  it("resolves a rename combined with an edit through the trailer", async () => {
    const listCommits = vi
      .fn()
      .mockResolvedValue([commit("Commitnote-Rename: a.md -> b.md")]);
    expect(
      await locate({ "a.md": "s1" }, { "b.md": "s9" }, "a.md", listCommits),
    ).toEqual(["b.md"]);
  });

  it("resolves a folder rename combined with an edit through the trailer", async () => {
    const listCommits = vi
      .fn()
      .mockResolvedValue([commit("Commitnote-Rename: old -> new")]);
    expect(
      await locate(
        { "old/a.md": "s1" },
        { "new/a.md": "s9" },
        "old/a.md",
        listCommits,
      ),
    ).toEqual(["new", "a.md"]);
  });

  it("applies several trailers in order", async () => {
    const listCommits = vi
      .fn()
      .mockResolvedValue([
        commit(
          "Commitnote-Rename: old -> mid",
          "Commitnote-Rename: mid/a.md -> mid/b.md",
        ),
      ]);
    expect(
      await locate(
        { "old/a.md": "s1" },
        { "mid/b.md": "s9" },
        "old/a.md",
        listCommits,
      ),
    ).toEqual(["mid", "b.md"]);
  });

  it("returns null when the trailer target is missing from the new tree", async () => {
    const listCommits = vi
      .fn()
      .mockResolvedValue([commit("Commitnote-Rename: a.md -> b.md")]);
    expect(
      await locate({ "a.md": "s1" }, { "c.md": "s9" }, "a.md", listCommits),
    ).toBeNull();
  });

  it("returns null without trailers or commits", async () => {
    expect(
      await locate({ "a.md": "s1" }, { "c.md": "s9" }, "a.md", vi.fn().mockResolvedValue([commit()])),
    ).toBeNull();
    expect(await locate({ "a.md": "s1" }, { "c.md": "s9" }, "a.md")).toBeNull();
  });

  it("returns null without listing commits when the note is in the trash", async () => {
    const listCommits = vi.fn();
    const trash = [
      {
        id: "t1",
        deletedAt: 1,
        undecryptable: false,
        kind: "note",
        originalPath: at("a.md"),
        storedRoot: "a.md",
        tree: { kind: "note", name: "a.md", path: [], storedPath: "a.md", blobSha: "s1" },
      },
    ] as unknown as TrashEntry[];
    expect(
      await locate({ "a.md": "s1" }, { "c.md": "s9" }, "a.md", listCommits, trash),
    ).toBeNull();
    expect(listCommits).not.toHaveBeenCalled();
  });

  it("returns null when listing commits rejects", async () => {
    const listCommits = vi.fn().mockRejectedValue(new Error("boom"));
    expect(
      await locate({ "a.md": "s1" }, { "c.md": "s9" }, "a.md", listCommits),
    ).toBeNull();
  });

  it("returns null when the note is still at its path", async () => {
    const listCommits = vi.fn();
    expect(
      await locate({ "a.md": "s1" }, { "a.md": "s2" }, "a.md", listCommits),
    ).toBeNull();
    expect(listCommits).not.toHaveBeenCalled();
  });

  it("returns null when the note was not in the previous tree", async () => {
    expect(await locate({}, { "b.md": "s1" }, "a.md")).toBeNull();
  });
});
