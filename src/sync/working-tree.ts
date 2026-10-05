import type { Change, ChangeSet, NotePath } from "../changes/change";
import {
  isAtOrWithin,
  isWithinFolder,
  notePathEquals,
  parentPath,
} from "../changes/change";
import {
  applyChangeToOrder,
  EMPTY_ORDER,
  siblingComparator,
  type OrderIndex,
} from "../order/order-index";
import { parseTrashEntryId } from "../trash/trash-entry-id";
import type { TrashEntry } from "../trash/trash-index";
import type { NoteTree, TreeNode } from "../tree/note-tree";
import type { WorkingTrashEntry } from "./working-trash";

export interface WorkingNote {
  readonly kind: "note";
  readonly name: string;
  readonly path: NotePath;
  readonly syncedPath: NotePath | null;
  /** Set for a note restored from a committed trash entry: its content is this blob. */
  readonly trashBlobSha?: string;
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

export interface WorkingState {
  readonly tree: WorkingTree;
  readonly trash: readonly WorkingTrashEntry[];
  readonly order: OrderIndex;
}

interface MutNote {
  readonly kind: "note";
  name: string;
  path: NotePath;
  syncedPath: NotePath | null;
  trashBlobSha: string | null;
}

interface MutFolder {
  readonly kind: "folder";
  name: string;
  path: NotePath;
  readonly children: Map<string, MutTreeNode>;
}

type MutTreeNode = MutNote | MutFolder;

type MutTrashEntry =
  | {
      readonly id: string;
      readonly deletedAt: number;
      readonly undecryptable: false;
      readonly synced: boolean;
      readonly kind: "note" | "folder";
      readonly originalPath: NotePath;
      readonly node: MutTreeNode;
    }
  | {
      readonly id: string;
      readonly deletedAt: number;
      readonly undecryptable: true;
      readonly synced: true;
    };

interface MutState {
  readonly root: MutFolder;
  readonly trash: Map<string, MutTrashEntry>;
  order: OrderIndex;
}

function cloneNode(node: TreeNode, fromTrash: boolean): MutTreeNode {
  if (node.kind === "note") {
    return {
      kind: "note",
      name: node.name,
      path: node.path,
      syncedPath: fromTrash ? null : node.path,
      trashBlobSha: fromTrash ? node.blobSha : null,
    };
  }
  const children = new Map<string, MutTreeNode>();
  for (const child of node.children) {
    children.set(child.name, cloneNode(child, fromTrash));
  }
  return { kind: "folder", name: node.name, path: node.path, children };
}

function initialState(
  synced: NoteTree,
  syncedTrash: readonly TrashEntry[],
  syncedOrder: OrderIndex = EMPTY_ORDER,
): MutState {
  const trash = new Map<string, MutTrashEntry>();
  for (const entry of syncedTrash) {
    trash.set(
      entry.id,
      entry.undecryptable
        ? {
            id: entry.id,
            deletedAt: entry.deletedAt,
            undecryptable: true,
            synced: true,
          }
        : {
            id: entry.id,
            deletedAt: entry.deletedAt,
            undecryptable: false,
            synced: true,
            kind: entry.kind,
            originalPath: entry.originalPath,
            node: cloneNode(entry.tree, true),
          },
    );
  }
  return {
    root: cloneNode(synced.root, false) as MutFolder,
    trash,
    order: syncedOrder,
  };
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

function findInTrashItem(
  item: MutTreeNode,
  subPath: NotePath,
): { node: MutTreeNode; parent: MutFolder | undefined } | undefined {
  let node = item;
  let parent: MutFolder | undefined;
  for (const name of subPath) {
    if (node.kind !== "folder") return undefined;
    const next = node.children.get(name);
    if (next === undefined) return undefined;
    parent = node;
    node = next;
  }
  return { node, parent };
}

function applyChangeOrThrow(state: MutState, change: Change): void {
  applyTreeChangeOrThrow(state, change);
  state.order = applyChangeToOrder(state.order, change);
}

function applyTreeChangeOrThrow(state: MutState, change: Change): void {
  const root = state.root;
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
        trashBlobSha: null,
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
        isAtOrWithin(change.to, change.from);
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
    case "trash-note":
    case "trash-folder": {
      const kind = change.kind === "trash-note" ? "note" : "folder";
      const node =
        change.path.length === 0 ? undefined : findMutNode(root, change.path);
      const parsed = parseTrashEntryId(change.entryId);
      if (
        node === undefined ||
        node.kind !== kind ||
        parsed === null ||
        parsed.depth !== change.path.length ||
        state.trash.has(change.entryId)
      ) {
        invalidChange();
      }
      findMutFolder(root, parentPath(change.path))!.children.delete(node.name);
      state.trash.set(change.entryId, {
        id: change.entryId,
        deletedAt: parsed.deletedAt,
        undecryptable: false,
        synced: false,
        kind,
        originalPath: change.path,
        node,
      });
      return;
    }
    case "restore-trash": {
      const entry = state.trash.get(change.entryId);
      if (entry === undefined || entry.undecryptable || change.to.length === 0) {
        invalidChange();
      }
      const found = findInTrashItem(entry.node, change.subPath);
      const targetParent = findMutFolder(root, parentPath(change.to));
      const targetName = change.to[change.to.length - 1];
      if (
        found === undefined ||
        found.node.kind !== change.target ||
        targetParent === undefined ||
        targetParent.children.has(targetName)
      ) {
        invalidChange();
      }
      if (found.parent === undefined) {
        state.trash.delete(entry.id);
      } else {
        found.parent.children.delete(found.node.name);
      }
      relocate(found.node, change.to);
      targetParent.children.set(targetName, found.node);
      return;
    }
    case "purge-trash":
      for (const entryId of change.entryIds) {
        state.trash.delete(entryId);
      }
      return;
    case "set-order": {
      const parent = findMutFolder(root, change.parent);
      if (
        parent === undefined ||
        change.positions.some(({ name }) => !parent.children.has(name))
      ) {
        invalidChange();
      }
      return;
    }
    case "set-settings":
      return;
  }
}

function finalizeNote(note: MutNote): WorkingNote {
  const base: WorkingNote = {
    kind: "note",
    name: note.name,
    path: note.path,
    syncedPath: note.syncedPath,
  };
  return note.trashBlobSha === null
    ? base
    : { ...base, trashBlobSha: note.trashBlobSha };
}

function finalize(folder: MutFolder, order: OrderIndex): WorkingFolder {
  const sorted = [...folder.children.values()].sort(
    siblingComparator(order, folder.path),
  );
  return {
    kind: "folder",
    name: folder.name,
    path: folder.path,
    children: sorted.map((child) =>
      child.kind === "folder" ? finalize(child, order) : finalizeNote(child),
    ),
  };
}

function finalizeTrash(
  trash: ReadonlyMap<string, MutTrashEntry>,
): WorkingTrashEntry[] {
  return [...trash.values()]
    .sort(
      (a, b) =>
        a.deletedAt - b.deletedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((entry) =>
      entry.undecryptable
        ? entry
        : {
            id: entry.id,
            deletedAt: entry.deletedAt,
            undecryptable: false,
            synced: entry.synced,
            kind: entry.kind,
            originalPath: entry.originalPath,
            tree:
              entry.node.kind === "folder"
                ? finalize(entry.node, EMPTY_ORDER)
                : finalizeNote(entry.node),
          },
    );
}

export function buildWorkingState(
  synced: NoteTree,
  changes: ChangeSet,
  syncedTrash: readonly TrashEntry[] = [],
  syncedOrder: OrderIndex = EMPTY_ORDER,
): WorkingState {
  const state = initialState(synced, syncedTrash, syncedOrder);
  for (const change of changes) {
    applyChangeOrThrow(state, change);
  }
  return {
    tree: { root: finalize(state.root, state.order) },
    trash: finalizeTrash(state.trash),
    order: state.order,
  };
}

export function buildWorkingTree(
  synced: NoteTree,
  changes: ChangeSet,
  syncedTrash: readonly TrashEntry[] = [],
  syncedOrder: OrderIndex = EMPTY_ORDER,
): WorkingTree {
  return buildWorkingState(synced, changes, syncedTrash, syncedOrder).tree;
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

function touchesPath(change: Change, path: NotePath): boolean {
  switch (change.kind) {
    case "delete-note":
    case "delete-folder":
    case "trash-note":
    case "trash-folder":
      return isAtOrWithin(path, change.path);
    case "rename-note":
    case "rename-folder":
      return (
        isAtOrWithin(path, change.from) || isAtOrWithin(path, change.to)
      );
    case "restore-trash":
      return isAtOrWithin(path, change.to);
    case "create-note":
    case "update-note":
    case "create-folder":
    case "purge-trash":
    case "set-order":
    case "set-settings":
      return false;
  }
}

// A later position of an item replaces its earlier one, as long as no
// structural change in between could have given the name to another item.
function appendSetOrder(
  changes: ChangeSet,
  change: Extract<Change, { kind: "set-order" }>,
): ChangeSet {
  const names = new Set(change.positions.map(({ name }) => name));
  const updated = changes.slice();
  for (let i = updated.length - 1; i >= 0; i--) {
    const existing = updated[i];
    if (existing.kind === "update-note") continue;
    if (existing.kind !== "set-order") break;
    if (!notePathEquals(existing.parent, change.parent)) continue;
    const positions = existing.positions.filter(({ name }) => !names.has(name));
    if (positions.length === 0) updated.splice(i, 1);
    else updated[i] = { ...existing, positions };
  }
  return [...updated, change];
}

export function appendChange(changes: ChangeSet, change: Change): ChangeSet {
  if (change.kind === "set-order") return appendSetOrder(changes, change);
  if (change.kind === "set-settings") {
    let values = change.values;
    const others: Change[] = [];
    for (const existing of changes) {
      if (existing.kind === "set-settings") {
        values = { ...existing.values, ...values };
      } else {
        others.push(existing);
      }
    }
    return [...others, { kind: "set-settings", values }];
  }
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
  // Content of trashed notes, by entry id and path relative to the trashed item.
  const trashed = new Map<string, Map<string, string>>();

  function trashedIn(entryId: string): Map<string, string> {
    let entry = trashed.get(entryId);
    if (entry === undefined) {
      entry = new Map();
      trashed.set(entryId, entry);
    }
    return entry;
  }

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
      case "set-order":
      case "set-settings":
        break;
      case "trash-note": {
        const key = JSON.stringify(change.path);
        const content = contents.get(key);
        if (content === undefined) break;
        contents.delete(key);
        trashedIn(change.entryId).set(JSON.stringify([]), content);
        break;
      }
      case "trash-folder":
        for (const [key, content] of [...contents]) {
          const notePath = JSON.parse(key) as string[];
          if (!isWithinFolder(notePath, change.path)) continue;
          contents.delete(key);
          trashedIn(change.entryId).set(
            JSON.stringify(notePath.slice(change.path.length)),
            content,
          );
        }
        break;
      case "restore-trash": {
        const entry = trashed.get(change.entryId);
        if (entry === undefined) break;
        for (const [key, content] of [...entry]) {
          const relative = JSON.parse(key) as string[];
          const restored =
            change.target === "note"
              ? notePathEquals(relative, change.subPath)
              : isWithinFolder(relative, change.subPath);
          if (!restored) continue;
          entry.delete(key);
          contents.set(
            JSON.stringify([
              ...change.to,
              ...relative.slice(change.subPath.length),
            ]),
            content,
          );
        }
        break;
      }
      case "purge-trash":
        for (const entryId of change.entryIds) trashed.delete(entryId);
        break;
    }
  }

  return contents.get(JSON.stringify(path));
}

export function rebaseChanges(
  synced: NoteTree,
  prefix: ChangeSet,
  changes: ChangeSet,
  syncedTrash: readonly TrashEntry[] = [],
): { readonly changes: ChangeSet; readonly dropped: readonly Change[] } {
  const state = initialState(synced, syncedTrash);
  for (const change of prefix) {
    applyChangeOrThrow(state, change);
  }
  const root = state.root;

  const kept: Change[] = [];
  const dropped: Change[] = [];

  function keepIfValid(change: Change): void {
    try {
      applyChangeOrThrow(state, change);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      dropped.push(change);
      return;
    }
    kept.push(change);
  }

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
          trashBlobSha: null,
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
            trashBlobSha: null,
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
          isAtOrWithin(change.to, change.from);
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
      case "trash-note":
      case "trash-folder": {
        const kind = change.kind === "trash-note" ? "note" : "folder";
        if (change.path.length === 0) break;
        if (findMutNode(root, change.path)?.kind !== kind) break;
        keepIfValid(change);
        break;
      }
      case "restore-trash":
        keepIfValid(change);
        break;
      case "purge-trash": {
        const entryIds = change.entryIds.filter((id) => state.trash.has(id));
        if (entryIds.length === 0) break;
        keepIfValid(
          entryIds.length === change.entryIds.length
            ? change
            : { kind: "purge-trash", entryIds },
        );
        break;
      }
      case "set-order": {
        const parent = findMutFolder(root, change.parent);
        if (parent === undefined) break;
        const positions = change.positions.filter(({ name }) =>
          parent.children.has(name),
        );
        if (positions.length === 0) break;
        if (positions.length === change.positions.length) {
          kept.push(change);
        } else {
          const { moved, ...rest } = change;
          kept.push(
            moved !== undefined && parent.children.has(moved)
              ? { ...change, positions }
              : { ...rest, positions },
          );
        }
        break;
      }
      case "set-settings":
        kept.push(change);
        break;
    }
  }

  return { changes: kept, dropped };
}
