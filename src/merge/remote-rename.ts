import type { NotePath } from "../changes/change";
import { isWithinFolder, notePathEquals } from "../changes/change";
import type { ShareEntry } from "../share/share-index";
import type { TrashEntry } from "../trash/trash-index";
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

export function findTrashedLocation(
  trash: readonly TrashEntry[],
  path: NotePath,
): { readonly entryId: string; readonly path: NotePath } | null {
  let found: { entryId: string; path: NotePath; deletedAt: number } | null =
    null;
  for (const entry of trash) {
    if (entry.undecryptable) continue;
    if (found !== null && entry.deletedAt <= found.deletedAt) continue;
    if (entry.kind === "note") {
      if (notePathEquals(entry.originalPath, path)) {
        found = { entryId: entry.id, path: [], deletedAt: entry.deletedAt };
      }
    } else if (
      entry.tree.kind === "folder" &&
      isWithinFolder(path, entry.originalPath)
    ) {
      const relative = path.slice(entry.originalPath.length);
      if (findNode({ root: entry.tree }, relative)?.kind === "note") {
        found = { entryId: entry.id, path: relative, deletedAt: entry.deletedAt };
      }
    }
  }
  return found === null ? null : { entryId: found.entryId, path: found.path };
}

export function relocateShareEntry(
  entry: ShareEntry,
  resolveActive: (path: NotePath) => NotePath | null,
  trash: readonly TrashEntry[],
): ShareEntry {
  if (entry.note.state !== "active") return entry;
  const active = resolveActive(entry.note.path);
  if (active !== null) {
    return { ...entry, note: { state: "active", path: active } };
  }
  const trashed = findTrashedLocation(trash, entry.note.path);
  if (trashed !== null) {
    return {
      ...entry,
      note: { state: "trashed", entryId: trashed.entryId, path: trashed.path },
    };
  }
  return { ...entry, note: { state: "deleted" } };
}
