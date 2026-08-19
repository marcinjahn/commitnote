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
  }
}
