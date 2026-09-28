import type { Change, ChangeSet, NotePath } from "../changes/change";
import { isWithinFolder, notePathEquals, parentPath } from "../changes/change";
import { compareNames } from "../tree/note-names";
import type { NoteTree, TreeNode } from "../tree/note-tree";

export interface WorkingNote {
  readonly kind: "note";
  readonly name: string;
  readonly path: NotePath;
  readonly syncedPath: NotePath | null;
}

export interface WorkingFolder {
  readonly kind: "folder";
  readonly name: string;
  readonly path: NotePath;
  readonly children: readonly WorkingNode[];
}

export type WorkingNode = WorkingNote | WorkingFolder;

export interface WorkingTree {
  readonly root: WorkingFolder;
}

interface MutNote {
  readonly kind: "note";
  name: string;
  path: NotePath;
  syncedPath: NotePath | null;
}

interface MutFolder {
  readonly kind: "folder";
  name: string;
  path: NotePath;
  readonly children: Map<string, MutTreeNode>;
}

type MutTreeNode = MutNote | MutFolder;

function cloneFromSynced(node: TreeNode): MutTreeNode {
  if (node.kind === "note") {
    return {
      kind: "note",
      name: node.name,
      path: node.path,
      syncedPath: node.path,
    };
  }
  const children = new Map<string, MutTreeNode>();
  for (const child of node.children) {
    children.set(child.name, cloneFromSynced(child));
  }
  return { kind: "folder", name: node.name, path: node.path, children };
}

function findMutNode(root: MutFolder, path: NotePath): MutTreeNode | undefined {
  let current: MutTreeNode = root;
  for (const name of path) {
    if (current.kind !== "folder") return undefined;
    const next = current.children.get(name);
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function findMutFolder(root: MutFolder, path: NotePath): MutFolder | undefined {
  const node = findMutNode(root, path);
  return node?.kind === "folder" ? node : undefined;
}

function relocate(node: MutTreeNode, newPath: NotePath): void {
  node.name = newPath[newPath.length - 1];
  node.path = newPath;
  if (node.kind === "folder") {
    for (const child of node.children.values()) {
      relocate(child, [...newPath, child.name]);
    }
  }
}

function invalidChange(): never {
  throw new RangeError("Change is invalid for this working tree");
}

function applyChangeOrThrow(root: MutFolder, change: Change): void {
  switch (change.kind) {
    case "create-folder": {
      const parent = findMutFolder(root, parentPath(change.path));
      const name = change.path[change.path.length - 1];
      if (parent === undefined || parent.children.has(name)) {
        invalidChange();
      }
      parent.children.set(name, {
        kind: "folder",
        name,
        path: change.path,
        children: new Map(),
      });
      return;
    }
    case "create-note": {
      const parent = findMutFolder(root, parentPath(change.path));
      const name = change.path[change.path.length - 1];
      if (parent === undefined || parent.children.has(name)) {
        invalidChange();
      }
      parent.children.set(name, {
        kind: "note",
        name,
        path: change.path,
        syncedPath: null,
      });
      return;
    }
    case "update-note": {
      const node = findMutNode(root, change.path);
      if (node === undefined || node.kind !== "note") invalidChange();
      return;
    }
    case "delete-note": {
      const node = findMutNode(root, change.path);
      if (node === undefined || node.kind !== "note") invalidChange();
      const parent = findMutFolder(root, parentPath(change.path))!;
      parent.children.delete(node.name);
      return;
    }
    case "delete-folder": {
      const node = findMutNode(root, change.path);
      if (node === undefined || node.kind !== "folder") invalidChange();
      const parent = findMutFolder(root, parentPath(change.path))!;
      parent.children.delete(node.name);
      return;
    }
    case "rename-note": {
      const source = findMutNode(root, change.from);
      const targetParent = findMutFolder(root, parentPath(change.to));
      const targetName = change.to[change.to.length - 1];
      if (
        source === undefined ||
        source.kind !== "note" ||
        targetParent === undefined ||
        targetParent.children.has(targetName)
      ) {
        invalidChange();
      }
      const sourceParent = findMutFolder(root, parentPath(change.from))!;
      sourceParent.children.delete(source.name);
      relocate(source, change.to);
      targetParent.children.set(targetName, source);
      return;
    }
    case "rename-folder": {
      const source = findMutNode(root, change.from);
      const targetParent = findMutFolder(root, parentPath(change.to));
      const targetName = change.to[change.to.length - 1];
      const insideSource =
        notePathEquals(change.to, change.from) ||
        isWithinFolder(change.to, change.from);
      if (
        source === undefined ||
        source.kind !== "folder" ||
        targetParent === undefined ||
        targetParent.children.has(targetName) ||
        insideSource
      ) {
        invalidChange();
      }
      const sourceParent = findMutFolder(root, parentPath(change.from))!;
      sourceParent.children.delete(source.name);
      relocate(source, change.to);
      targetParent.children.set(targetName, source);
      return;
    }
  }
}

function finalize(folder: MutFolder): WorkingFolder {
  const sorted = [...folder.children.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return compareNames(a.name, b.name);
  });
  return {
    kind: "folder",
    name: folder.name,
    path: folder.path,
    children: sorted.map((child) =>
      child.kind === "folder"
        ? finalize(child)
        : {
            kind: "note",
            name: child.name,
            path: child.path,
            syncedPath: child.syncedPath,
          },
    ),
  };
}

export function buildWorkingTree(
  synced: NoteTree,
  changes: ChangeSet,
): WorkingTree {
  const root = cloneFromSynced(synced.root) as MutFolder;
  for (const change of changes) {
    applyChangeOrThrow(root, change);
  }
  return { root: finalize(root) };
}

export function findWorkingNode(
  tree: WorkingTree,
  path: NotePath,
): WorkingNode | undefined {
  let current: WorkingNode = tree.root;
  for (const name of path) {
    if (current.kind !== "folder") return undefined;
    const next: WorkingNode | undefined = current.children.find(
      (child) => child.name === name,
    );
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function isAtOrAncestorOf(candidate: NotePath, path: NotePath): boolean {
  return notePathEquals(candidate, path) || isWithinFolder(path, candidate);
}

function touchesPath(change: Change, path: NotePath): boolean {
  switch (change.kind) {
    case "delete-note":
    case "delete-folder":
      return isAtOrAncestorOf(change.path, path);
    case "rename-note":
    case "rename-folder":
      return (
        isAtOrAncestorOf(change.from, path) || isAtOrAncestorOf(change.to, path)
      );
    default:
      return false;
  }
}

export function appendChange(changes: ChangeSet, change: Change): ChangeSet {
  if (change.kind === "update-note") {
    for (let i = changes.length - 1; i >= 0; i--) {
      const existing = changes[i];
      if (touchesPath(existing, change.path)) break;
      if (
        (existing.kind === "create-note" || existing.kind === "update-note") &&
        notePathEquals(existing.path, change.path)
      ) {
        const updated = changes.slice();
        updated[i] = { ...existing, content: change.content };
        return updated;
      }
    }
  }
  return [...changes, change];
}

export function localContentAt(
  changes: ChangeSet,
  path: NotePath,
): string | undefined {
  const contents = new Map<string, string>();

  function moveNote(from: NotePath, to: NotePath): void {
    const key = JSON.stringify(from);
    const content = contents.get(key);
    if (content === undefined) return;
    contents.delete(key);
    contents.set(JSON.stringify(to), content);
  }

  function moveFolder(from: NotePath, to: NotePath): void {
    for (const [key, content] of [...contents]) {
      const notePath = JSON.parse(key) as string[];
      if (!isWithinFolder(notePath, from)) continue;
      contents.delete(key);
      const rebased = [...to, ...notePath.slice(from.length)];
      contents.set(JSON.stringify(rebased), content);
    }
  }

  for (const change of changes) {
    switch (change.kind) {
      case "create-note":
      case "update-note":
        contents.set(JSON.stringify(change.path), change.content);
        break;
      case "delete-note":
        contents.delete(JSON.stringify(change.path));
        break;
      case "delete-folder":
        for (const key of [...contents.keys()]) {
          const notePath = JSON.parse(key) as string[];
          if (isWithinFolder(notePath, change.path)) contents.delete(key);
        }
        break;
      case "rename-note":
        moveNote(change.from, change.to);
        break;
      case "rename-folder":
        moveFolder(change.from, change.to);
        break;
      case "create-folder":
        break;
    }
  }

  return contents.get(JSON.stringify(path));
}

export function rebaseChanges(
  synced: NoteTree,
  prefix: ChangeSet,
  changes: ChangeSet,
): { readonly changes: ChangeSet; readonly dropped: readonly Change[] } {
  const root = cloneFromSynced(synced.root) as MutFolder;
  for (const change of prefix) {
    applyChangeOrThrow(root, change);
  }

  const kept: Change[] = [];
  const dropped: Change[] = [];

  function parentFolderOf(path: NotePath): MutFolder | undefined {
    if (path.length === 0) return undefined;
    return findMutFolder(root, parentPath(path));
  }

  function canCreateNoteAt(path: NotePath): boolean {
    for (let length = 1; length <= path.length; length++) {
      const node = findMutNode(root, path.slice(0, length));
      if (node === undefined) continue;
      if (length === path.length) return false;
      if (node.kind !== "folder") return false;
    }
    return true;
  }

  function createMissingFolders(path: NotePath): void {
    for (let length = 1; length < path.length; length++) {
      const folderPath = path.slice(0, length);
      if (findMutNode(root, folderPath) !== undefined) continue;
      const parent = parentFolderOf(folderPath)!;
      const name = folderPath[folderPath.length - 1];
      parent.children.set(name, {
        kind: "folder",
        name,
        path: folderPath,
        children: new Map(),
      });
      kept.push({ kind: "create-folder", path: folderPath });
    }
  }

  for (const change of changes) {
    switch (change.kind) {
      case "update-note": {
        const node = findMutNode(root, change.path);
        if (node?.kind === "note") {
          kept.push(change);
          break;
        }
        if (!canCreateNoteAt(change.path)) {
          dropped.push(change);
          break;
        }
        createMissingFolders(change.path);
        const parent = parentFolderOf(change.path)!;
        const name = change.path[change.path.length - 1];
        parent.children.set(name, {
          kind: "note",
          name,
          path: change.path,
          syncedPath: null,
        });
        kept.push({
          kind: "create-note",
          path: change.path,
          content: change.content,
        });
        break;
      }
      case "create-note": {
        const parent = parentFolderOf(change.path);
        if (parent === undefined) {
          dropped.push(change);
          break;
        }
        const name = change.path[change.path.length - 1];
        const existing = parent.children.get(name);
        if (existing === undefined) {
          parent.children.set(name, {
            kind: "note",
            name,
            path: change.path,
            syncedPath: null,
          });
          kept.push(change);
        } else if (existing.kind === "note") {
          kept.push({
            kind: "update-note",
            path: change.path,
            content: change.content,
          });
        } else {
          dropped.push(change);
        }
        break;
      }
      case "create-folder": {
        const parent = parentFolderOf(change.path);
        if (parent === undefined) {
          dropped.push(change);
          break;
        }
        const name = change.path[change.path.length - 1];
        const existing = parent.children.get(name);
        if (existing === undefined) {
          parent.children.set(name, {
            kind: "folder",
            name,
            path: change.path,
            children: new Map(),
          });
          kept.push(change);
        } else if (existing.kind !== "folder") {
          dropped.push(change);
        }
        // A folder that already exists is skipped silently.
        break;
      }
      case "delete-note": {
        const node = findMutNode(root, change.path);
        if (node === undefined || node.kind !== "note") break;
        const parent = parentFolderOf(change.path)!;
        parent.children.delete(node.name);
        kept.push(change);
        break;
      }
      case "delete-folder": {
        if (change.path.length === 0) break;
        const node = findMutNode(root, change.path);
        if (node === undefined || node.kind !== "folder") break;
        const parent = parentFolderOf(change.path)!;
        parent.children.delete(node.name);
        kept.push(change);
        break;
      }
      case "rename-note": {
        const source = findMutNode(root, change.from);
        const targetParent = parentFolderOf(change.to);
        const targetName = change.to[change.to.length - 1];
        if (
          source === undefined ||
          source.kind !== "note" ||
          targetParent === undefined ||
          targetParent.children.has(targetName)
        ) {
          dropped.push(change);
          break;
        }
        const sourceParent = parentFolderOf(change.from)!;
        sourceParent.children.delete(source.name);
        relocate(source, change.to);
        targetParent.children.set(targetName, source);
        kept.push(change);
        break;
      }
      case "rename-folder": {
        if (change.from.length === 0) {
          dropped.push(change);
          break;
        }
        const source = findMutNode(root, change.from);
        const targetParent = parentFolderOf(change.to);
        const targetName = change.to[change.to.length - 1];
        const insideSource =
          notePathEquals(change.to, change.from) ||
          isWithinFolder(change.to, change.from);
        if (
          source === undefined ||
          source.kind !== "folder" ||
          targetParent === undefined ||
          targetParent.children.has(targetName) ||
          insideSource
        ) {
          dropped.push(change);
          break;
        }
        const sourceParent = parentFolderOf(change.from)!;
        sourceParent.children.delete(source.name);
        relocate(source, change.to);
        targetParent.children.set(targetName, source);
        kept.push(change);
        break;
      }
    }
  }

  return { changes: kept, dropped };
}
