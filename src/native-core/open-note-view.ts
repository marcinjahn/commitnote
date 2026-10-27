import type { OpenNoteState } from "../sync/sync-engine";
import type { OpenNote } from "./api";
import { toCoreError } from "./core-errors";

export const MISSING_NOTE_MESSAGE = "This note no longer exists.";
export const TRASHED_NOTE_MESSAGE = "This note was moved to trash.";

export function toOpenNote(
  state: OpenNoteState | null,
  forgeName: string,
): OpenNote | null {
  if (state === null) return null;
  const path = [...state.path];
  switch (state.kind) {
    case "loading":
      return { state: "loading", path };
    case "loaded":
      return { state: "loaded", path, content: state.content };
    case "missing":
      return { state: "missing", path, message: MISSING_NOTE_MESSAGE };
    case "trashed":
      return { state: "trashed", path, message: TRASHED_NOTE_MESSAGE };
    case "failed": {
      const error = toCoreError(state.error, { source: "sync", forgeName });
      return { state: "failed", path, message: error.message, error };
    }
  }
}
