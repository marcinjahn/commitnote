import { describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { ShareEntry } from "../share/share-index";
import type { TrashEntry } from "../trash/trash-index";
import type { FolderNode, NoteTree, TreeNode } from "../tree/note-tree";
import { findNode } from "../tree/note-tree";
import {
  findRemoteRename,
  findTrashedLocation,
  relocateShareEntry,
} from "./remote-rename";

function treeOf(notes: Record<string, string>): NoteTree {
  const root: FolderNode = {
    kind: "folder",
    name: "",
    path: [],
    storedPath: "",
    children: [],
  };
  const folders = new Map<string, { node: FolderNode; children: TreeNode[] }>();
  const rootChildren: TreeNode[] = [];
  folders.set("", { node: root, children: rootChildren });
  const ensure = (path: string[]): TreeNode[] => {
    const key = path.join("/");
    const existing = folders.get(key);
    if (existing) return existing.children;
    const parent = ensure(path.slice(0, -1));
    const children: TreeNode[] = [];
    const node: FolderNode = {
      kind: "folder",
      name: path[path.length - 1],
      path,
      storedPath: key,
      children,
    };
    folders.set(key, { node, children });
    parent.push(node);
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

describe("findRemoteRename", () => {
  it("finds a remote rename in place", () => {
    const base = treeOf({ "a.md": "s1", "other.md": "s2" });
    const remote = treeOf({ "b.md": "s1", "other.md": "s2" });
    expect(findRemoteRename(base, remote, at("a.md"))).toEqual(["b.md"]);
  });

  it("finds a remote move to another folder", () => {
    const base = treeOf({ "a.md": "s1" });
    const remote = treeOf({ "f/g/a.md": "s1" });
    expect(findRemoteRename(base, remote, at("a.md"))).toEqual(["f", "g", "a.md"]);
  });

  it("finds a note inside a remotely renamed folder", () => {
    const base = treeOf({ "old/a.md": "s1", "old/b.md": "s2" });
    const remote = treeOf({ "new/a.md": "s1", "new/b.md": "s2" });
    expect(findRemoteRename(base, remote, at("old/a.md"))).toEqual([
      "new",
      "a.md",
    ]);
  });

  it("returns null when the note is still at the path", () => {
    const base = treeOf({ "a.md": "s1" });
    const remote = treeOf({ "a.md": "s1", "copy.md": "s1" });
    expect(findRemoteRename(base, remote, at("a.md"))).toBeNull();
  });

  it("returns null when the note was deleted remotely", () => {
    const base = treeOf({ "a.md": "s1", "other.md": "s2" });
    const remote = treeOf({ "other.md": "s2" });
    expect(findRemoteRename(base, remote, at("a.md"))).toBeNull();
  });

  it("returns null when the note was renamed and edited remotely", () => {
    const base = treeOf({ "a.md": "s1" });
    const remote = treeOf({ "b.md": "s1-edited" });
    expect(findRemoteRename(base, remote, at("a.md"))).toBeNull();
  });

  it("returns null when several remote notes share the blob", () => {
    const base = treeOf({ "a.md": "s1" });
    const remote = treeOf({ "b.md": "s1", "c.md": "s1" });
    expect(findRemoteRename(base, remote, at("a.md"))).toBeNull();
  });

  it("returns null when the path is not a note in the base", () => {
    const base = treeOf({ "f/a.md": "s1" });
    const remote = treeOf({ "g/a.md": "s1" });
    expect(findRemoteRename(base, remote, at("f"))).toBeNull();
    expect(findRemoteRename(base, remote, at("missing.md"))).toBeNull();
  });

  it("ignores remote notes that already had the blob in the base", () => {
    const base = treeOf({ "a.md": "s1", "copy.md": "s1" });
    const remote = treeOf({ "b.md": "s1", "copy.md": "s1" });
    expect(findRemoteRename(base, remote, at("a.md"))).toEqual(["b.md"]);
  });
});

function trashEntry(
  id: string,
  deletedAt: number,
  originalPath: string,
  notes: Record<string, string>,
): TrashEntry {
  const tree = findNode(treeOf(notes), at(originalPath))!;
  return {
    id,
    deletedAt,
    files: [],
    undecryptable: false,
    kind: tree.kind,
    originalPath: at(originalPath),
    storedRoot: originalPath,
    tree,
  };
}

describe("findTrashedLocation", () => {
  it("finds a trashed note", () => {
    const trash = [trashEntry("e1", 1, "f/a.md", { "f/a.md": "s1" })];
    expect(findTrashedLocation(trash, at("f/a.md"))).toEqual({
      entryId: "e1",
      path: [],
    });
  });

  it("finds a note nested in a trashed folder", () => {
    const trash = [
      trashEntry("e1", 1, "f", { "f/g/a.md": "s1", "f/b.md": "s2" }),
    ];
    expect(findTrashedLocation(trash, at("f/g/a.md"))).toEqual({
      entryId: "e1",
      path: ["g", "a.md"],
    });
  });

  it("returns null when no entry holds the note", () => {
    const trash = [
      trashEntry("e1", 1, "f", { "f/b.md": "s2" }),
      trashEntry("e2", 2, "other.md", { "other.md": "s3" }),
    ];
    expect(findTrashedLocation(trash, at("f/a.md"))).toBeNull();
    expect(findTrashedLocation(trash, at("f"))).toBeNull();
    expect(findTrashedLocation([], at("a.md"))).toBeNull();
  });

  it("takes the most recently trashed match", () => {
    const trash = [
      trashEntry("old", 1, "f/a.md", { "f/a.md": "s1" }),
      trashEntry("new", 3, "f", { "f/a.md": "s2" }),
      trashEntry("mid", 2, "f/a.md", { "f/a.md": "s3" }),
    ];
    expect(findTrashedLocation(trash, at("f/a.md"))).toEqual({
      entryId: "new",
      path: ["a.md"],
    });
  });

  it("ignores undecryptable entries", () => {
    const trash: TrashEntry[] = [
      { id: "bad", deletedAt: 5, files: [], undecryptable: true },
      trashEntry("e1", 1, "a.md", { "a.md": "s1" }),
    ];
    expect(findTrashedLocation(trash, at("a.md"))).toEqual({
      entryId: "e1",
      path: [],
    });
  });
});

describe("relocateShareEntry", () => {
  const share = (note: ShareEntry["note"]): ShareEntry => ({
    id: "share-1",
    locator: { provider: "github", gistId: "gist" },
    linkSecret: "secret",
    password: null,
    name: "a",
    label: null,
    sharedAt: "2026-01-01T00:00:00.000Z",
    note,
    source: null,
    updatedAt: null,
  });
  const trash = [trashEntry("e1", 1, "f", { "f/a.md": "s1" })];

  it("leaves an entry that is not active unchanged", () => {
    const entry = share({ state: "deleted" });
    expect(relocateShareEntry(entry, () => at("x.md"), trash)).toBe(entry);
  });

  it("follows the resolved active path", () => {
    expect(
      relocateShareEntry(
        share({ state: "active", path: at("a.md") }),
        () => at("b.md"),
        trash,
      ).note,
    ).toEqual({ state: "active", path: ["b.md"] });
  });

  it("marks the note trashed when it is in the trash", () => {
    expect(
      relocateShareEntry(
        share({ state: "active", path: at("f/a.md") }),
        () => null,
        trash,
      ).note,
    ).toEqual({ state: "trashed", entryId: "e1", path: ["a.md"] });
  });

  it("marks the note deleted when it is nowhere", () => {
    expect(
      relocateShareEntry(
        share({ state: "active", path: at("a.md") }),
        () => null,
        trash,
      ).note,
    ).toEqual({ state: "deleted" });
  });
});
