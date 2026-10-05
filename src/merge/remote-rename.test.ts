import { describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { FolderNode, NoteTree, TreeNode } from "../tree/note-tree";
import { findRemoteRename } from "./remote-rename";

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
