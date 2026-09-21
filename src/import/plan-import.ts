import type { Change, ChangeSet, NotePath } from "../changes/change";
import { utf8Encode } from "../crypto/base64";
import { MAX_NAME_BYTES } from "../format/v1";
import {
  findWorkingNode,
  type WorkingFolder,
  type WorkingTree,
} from "../sync/working-tree";
import { compareNames, validateName } from "../tree/note-names";
import type { ArchiveImportEntry } from "./read-notes-archive";

export type ImportDestination =
  | { readonly kind: "root" }
  | { readonly kind: "folder"; readonly path: NotePath }
  | {
      readonly kind: "new-folder";
      readonly parent: NotePath;
      readonly name: string;
    };

export type CollisionPolicy = "stop" | "rename";

export interface ImportSummary {
  readonly notes: number;
  readonly folders: number;
  readonly renamed: number;
  readonly conflicts: number;
}

export type ImportPlan =
  | {
      readonly ok: true;
      readonly changes: ChangeSet;
      readonly summary: ImportSummary;
    }
  | {
      readonly ok: false;
      readonly reason: "conflicts";
      readonly conflicts: number;
    };

interface ImportFolder {
  readonly kind: "folder";
  readonly name: string;
  readonly children: ImportNode[];
  readonly folders: Map<string, ImportFolder>;
}

interface ImportNote {
  readonly kind: "note";
  readonly name: string;
  readonly content: string;
}

type ImportNode = ImportFolder | ImportNote;

function newImportFolder(name: string): ImportFolder {
  return { kind: "folder", name, children: [], folders: new Map() };
}

function buildImportTree(entries: readonly ArchiveImportEntry[]): ImportFolder {
  const root = newImportFolder("");
  function ensureFolder(parent: ImportFolder, name: string): ImportFolder {
    let folder = parent.folders.get(name);
    if (folder === undefined) {
      folder = newImportFolder(name);
      parent.folders.set(name, folder);
      parent.children.push(folder);
    }
    return folder;
  }
  for (const entry of entries) {
    const parents =
      entry.kind === "folder" ? entry.path : entry.path.slice(0, -1);
    let parent = root;
    for (const name of parents) parent = ensureFolder(parent, name);
    if (entry.kind === "note") {
      parent.children.push({
        kind: "note",
        name: entry.path[entry.path.length - 1],
        content: entry.content,
      });
    }
  }
  return root;
}

function sortedChildren(folder: ImportFolder): ImportNode[] {
  return [...folder.children].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return compareNames(a.name, b.name);
  });
}

function fitSuffix(name: string, suffix: string): string {
  const maxStemBytes = MAX_NAME_BYTES - utf8Encode(suffix).length;
  const codePoints = [...name];
  while (utf8Encode(codePoints.join("")).length > maxStemBytes) {
    codePoints.pop();
  }
  return `${codePoints.join("").trimEnd()}${suffix}`;
}

function nextFreeName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const candidate = fitSuffix(name, ` (${n})`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function workingFolderAt(
  tree: WorkingTree,
  path: NotePath,
): WorkingFolder | undefined {
  const node = findWorkingNode(tree, path);
  return node?.kind === "folder" ? node : undefined;
}

export function planImport(
  tree: WorkingTree,
  destination: ImportDestination,
  entries: readonly ArchiveImportEntry[],
  policy: CollisionPolicy,
): ImportPlan {
  const imported = buildImportTree(entries);
  const changes: Change[] = [];
  let notes = 0;
  let folders = 0;
  let renamed = 0;
  let conflicts = 0;

  function place(
    existing: WorkingFolder | undefined,
    parentPath: NotePath,
    children: readonly ImportNode[],
    mergeFolders: boolean,
  ): void {
    const existingNames = new Set(
      existing?.children.map((child) => child.name.toLowerCase()) ?? [],
    );
    const taken = new Set(existingNames);
    for (const child of children) {
      if (child.kind === "folder" && mergeFolders && existing !== undefined) {
        const match = existing.children.find(
          (node) => node.kind === "folder" && node.name === child.name,
        );
        if (match?.kind === "folder") {
          place(match, match.path, sortedChildren(child), true);
          continue;
        }
      }

      let name = child.name;
      const lower = name.toLowerCase();
      if (taken.has(lower)) {
        if (existingNames.has(lower)) conflicts++;
        renamed++;
        name = nextFreeName(name, taken);
      }
      taken.add(name.toLowerCase());

      const path = [...parentPath, name];
      if (child.kind === "folder") {
        changes.push({ kind: "create-folder", path });
        folders++;
        place(undefined, path, sortedChildren(child), false);
      } else {
        changes.push({ kind: "create-note", path, content: child.content });
        notes++;
      }
    }
  }

  if (destination.kind === "new-folder") {
    const parent = workingFolderAt(tree, destination.parent);
    if (parent === undefined) {
      throw new RangeError("Import destination is not an existing folder");
    }
    const validation = validateName(destination.name, []);
    if (!validation.ok) {
      throw new RangeError("Import folder name is invalid");
    }
    const wrapper: ImportFolder = {
      ...imported,
      name: validation.name,
    };
    place(parent, parent.path, [wrapper], false);
  } else {
    const path = destination.kind === "root" ? [] : destination.path;
    const target = workingFolderAt(tree, path);
    if (target === undefined) {
      throw new RangeError("Import destination is not an existing folder");
    }
    place(target, target.path, sortedChildren(imported), true);
  }

  if (policy === "stop" && conflicts > 0) {
    return { ok: false, reason: "conflicts", conflicts };
  }
  return {
    ok: true,
    changes,
    summary: { notes, folders, renamed, conflicts },
  };
}
