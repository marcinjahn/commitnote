import type { NotePath } from "../changes/change";
import type { NoteTree } from "../tree/note-tree";
import { findNode, listNotes } from "../tree/note-tree";

export function findRemoteRename(
  base: NoteTree,
  remote: NoteTree,
  path: NotePath,
): NotePath | null {
  const baseNode = findNode(base, path);
  if (baseNode?.kind !== "note") return null;
  if (findNode(remote, path)?.kind === "note") return null;

  const candidates = listNotes(remote).filter((note) => {
    if (note.blobSha !== baseNode.blobSha) return false;
    const inBase = findNode(base, note.path);
    return !(inBase?.kind === "note" && inBase.blobSha === baseNode.blobSha);
  });
  return candidates.length === 1 ? candidates[0].path : null;
}
