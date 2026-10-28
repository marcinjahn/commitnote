import { notePathEquals } from "../changes/change";
import type { HeldConflict, SyncEngineState } from "../sync/sync-engine";
import {
  CONFLICT_BANNER_TEXT,
  CONFLICT_EDIT_HINT,
  CONFLICT_EDIT_MERGED_LABEL,
  conflictBannerHeading,
  keepOtherDeviceLabel,
  keepThisDeviceLabel,
} from "../ui/note/conflict-copy";
import type { OpenNote, OpenNoteConflict } from "./api";
import { toCoreError } from "./core-errors";

export const MISSING_NOTE_MESSAGE = "This note no longer exists.";
export const TRASHED_NOTE_MESSAGE = "This note was moved to trash.";

function toConflict(
  conflict: HeldConflict,
  deviceName: string,
): OpenNoteConflict {
  const otherDevice = conflict.theirsDevice;
  return {
    otherDevice,
    heading: conflictBannerHeading(otherDevice),
    text: CONFLICT_BANNER_TEXT,
    keepThisLabel: keepThisDeviceLabel(deviceName),
    keepOtherLabel: keepOtherDeviceLabel(otherDevice),
    editMergedLabel: CONFLICT_EDIT_MERGED_LABEL,
    editHint: CONFLICT_EDIT_HINT,
    merged: conflict.merged,
    editing: conflict.editing !== null,
  };
}

export function toOpenNote(
  state: Pick<SyncEngineState, "openNote" | "conflicts">,
  context: { readonly forgeName: string; readonly deviceName: () => string },
): OpenNote | null {
  const open = state.openNote;
  if (open === null) return null;
  const path = [...open.path];
  switch (open.kind) {
    case "loading":
      return { state: "loading", path };
    case "loaded": {
      const held = state.conflicts.find((c) => notePathEquals(c.path, open.path));
      return {
        state: "loaded",
        path,
        content: open.content,
        conflict:
          held === undefined ? null : toConflict(held, context.deviceName()),
      };
    }
    case "missing":
      return { state: "missing", path, message: MISSING_NOTE_MESSAGE };
    case "trashed":
      return { state: "trashed", path, message: TRASHED_NOTE_MESSAGE };
    case "failed": {
      const error = toCoreError(open.error, {
        source: "sync",
        forgeName: context.forgeName,
      });
      return { state: "failed", path, message: error.message, error };
    }
  }
}
