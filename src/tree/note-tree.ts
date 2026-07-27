import type { NotePath } from "../changes/change";
import type { Keyring } from "../crypto/keyring";
import { decryptName } from "../crypto/name-cipher";
import type { TreeEntry } from "../forge/forge-adapter";
import { FOLDER_MARKER, REPO_CONFIG_DIR } from "../format/v1";
import { compareNames } from "./note-names";

export interface NoteNode {
  readonly kind: "note";
  readonly name: string;
  readonly path: NotePath;
  readonly storedPath: string;
  readonly blobSha: string;
}

export interface FolderNode {
  readonly kind: "folder";
  readonly name: string;
  readonly path: NotePath;
  readonly storedPath: string;
  readonly children: readonly TreeNode[];
}

export type TreeNode = NoteNode | FolderNode;

export interface NoteTree {
  readonly root: FolderNode;
}

interface MutableFolder {
  readonly kind: "folder";
  readonly name: string;
  readonly path: readonly string[];
  readonly storedPath: string;
  readonly children: Map<string, MutableFolder | NoteNode>;
}

function isIgnoredPath(path: string): boolean {
  return path === REPO_CONFIG_DIR || path.startsWith(`${REPO_CONFIG_DIR}/`);
}

function finalizeFolder(folder: MutableFolder): FolderNode {
  const sorted = [...folder.children.values()].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return compareNames(a.name, b.name);
  });
  return {
    kind: "folder",
    name: folder.name,
    path: folder.path,
    storedPath: folder.storedPath,
    children: sorted.map((child) =>
      child.kind === "folder" ? finalizeFolder(child) : child,
    ),
  };
}

export async function buildNoteTree(
  entries: readonly TreeEntry[],
  keyring: Keyring,
): Promise<NoteTree> {
  const decryptCache = new Map<string, string | null>();
  async function decryptSegment(segment: string): Promise<string | null> {
    const cached = decryptCache.get(segment);
    if (cached !== undefined) return cached;
    const name = await decryptName(keyring, segment);
    decryptCache.set(segment, name);
    return name;
  }

  const root: MutableFolder = {
    kind: "folder",
    name: "",
    path: [],
    storedPath: "",
    children: new Map(),
  };
  const folderIndex = new Map<string, MutableFolder>([["[]", root]]);

  function ensureFolder(
    namesPath: readonly string[],
    storedPath: string,
  ): MutableFolder {
    if (namesPath.length === 0) return root;
    const key = JSON.stringify(namesPath);
    const existing = folderIndex.get(key);
    if (existing !== undefined) return existing;

    const parentStoredPath = storedPath.split("/").slice(0, -1).join("/");
    const parent = ensureFolder(namesPath.slice(0, -1), parentStoredPath);

    const folder: MutableFolder = {
      kind: "folder",
      name: namesPath[namesPath.length - 1],
      path: namesPath,
      storedPath,
      children: new Map(),
    };
    folderIndex.set(key, folder);
    parent.children.set(folder.name, folder);
    return folder;
  }

  for (const entry of entries) {
    if (isIgnoredPath(entry.path)) continue;

    const segments = entry.path.split("/");
    const lastSegment = segments[segments.length - 1];
    if (entry.type === "blob" && lastSegment === FOLDER_MARKER) continue;

    const names: string[] = [];
    let undecryptable = false;
    for (const segment of segments) {
      const name = await decryptSegment(segment);
      if (name === null) {
        undecryptable = true;
        break;
      }
      names.push(name);
    }
    if (undecryptable) continue;

    if (entry.type === "tree") {
      ensureFolder(names, entry.path);
    } else {
      const parentNames = names.slice(0, -1);
      const parentStoredPath = segments.slice(0, -1).join("/");
      const parent = ensureFolder(parentNames, parentStoredPath);
      const noteName = names[names.length - 1];
      const note: NoteNode = {
        kind: "note",
        name: noteName,
        path: names,
        storedPath: entry.path,
        blobSha: entry.sha,
      };
      parent.children.set(noteName, note);
    }
  }

  return { root: finalizeFolder(root) };
}

export function findNode(tree: NoteTree, path: NotePath): TreeNode | undefined {
  let current: TreeNode = tree.root;
  for (const name of path) {
    if (current.kind !== "folder") return undefined;
    const next: TreeNode | undefined = current.children.find(
      (child) => child.name === name,
    );
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

export function listNotes(tree: NoteTree): NoteNode[] {
  const notes: NoteNode[] = [];
  function walk(folder: FolderNode): void {
    for (const child of folder.children) {
      if (child.kind === "note") {
        notes.push(child);
      } else {
        walk(child);
      }
    }
  }
  walk(tree.root);
  return notes;
}
