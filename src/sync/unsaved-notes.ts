import type { ChangeSet, NotePath } from "../changes/change";
import { entryPathOf } from "./sync-state";
import type { WorkingFolder, WorkingTree } from "./working-tree";
import { findWorkingNode } from "./working-tree";

export interface UnsavedNotes {
  readonly notes: readonly NotePath[];
  readonly others: number;
}

export function listUnsavedNotes(input: {
  readonly pending: ChangeSet;
  readonly inFlight: ChangeSet;
  readonly conflicts: readonly NotePath[];
  readonly tree: WorkingTree;
  readonly unsavedCount: number;
}): UnsavedNotes {
  const { pending, inFlight, conflicts, tree, unsavedCount } = input;

  const candidateKeys = new Set<string>();
  const addCandidate = (path: NotePath | null): void => {
    if (path === null) return;
    const node = findWorkingNode(tree, path);
    if (node?.kind === "note") candidateKeys.add(node.path.join("/"));
  };
  for (const change of inFlight) addCandidate(entryPathOf(change));
  for (const change of pending) addCandidate(entryPathOf(change));
  for (const path of conflicts) addCandidate(path);

  const notes: NotePath[] = [];
  const walk = (folder: WorkingFolder): void => {
    for (const child of folder.children) {
      if (child.kind === "folder") walk(child);
      else if (candidateKeys.has(child.path.join("/"))) notes.push(child.path);
    }
  };
  walk(tree.root);

  return { notes, others: Math.max(0, unsavedCount - notes.length) };
}
