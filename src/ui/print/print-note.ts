import { notePathEquals } from "../../changes/change";
import type { HeldConflict, OpenNoteState } from "../../sync/sync-engine";
import type { NoteDraft } from "../note/note-draft";

export interface PrintNote {
  readonly name: string;
  readonly text: string;
}

export function derivePrintNote(
  draft: NoteDraft | null,
  openNote: OpenNoteState | null,
  conflicts: readonly HeldConflict[],
): PrintNote | null {
  if (draft !== null) return { name: draft.name, text: "" };
  if (openNote === null || openNote.kind !== "loaded") return null;
  const name = openNote.path[openNote.path.length - 1] ?? "";
  const conflict = conflicts.find((held) => notePathEquals(held.path, openNote.path));
  return { name, text: conflict ? (conflict.editing ?? conflict.merged) : openNote.content };
}
