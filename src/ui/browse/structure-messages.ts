import type { NotePath } from "../../changes/change";
import type { StructureError } from "../../sync/sync-engine";
import { describeNameError } from "../dialogs/name-messages";

export function describeStructureError(error: StructureError): string {
  switch (error.kind) {
    case "invalidName":
      return describeNameError(error.error);
    case "conflicted":
      return "Resolve the conflict in this note first.";
    case "notFound":
      return "This item no longer exists.";
    case "invalidTarget":
      return "A folder can't be moved into itself.";
    case "orderUnavailable":
      return "Items can't be reordered because the stored order couldn't be read.";
    case "tagsUnavailable":
      return "Color tags can't be changed because the stored tags can't be read.";
  }
}

export function describeMovedTo(name: string, folder: NotePath): string {
  return folder.length === 0
    ? `“${name}” moved to the top level`
    : `“${name}” moved to “${folder[folder.length - 1]}”`;
}
