import type { StructureError } from "../../sync/sync-engine";
import { TRASH_RETENTION_MS } from "../../format/v1";

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeDaysLeft(deletedAt: number, now: number): string {
  const days = Math.max(
    1,
    Math.ceil((deletedAt + TRASH_RETENTION_MS - now) / DAY_MS),
  );
  return days === 1 ? "1 day left" : `${days} days left`;
}

export function describeEmptyTrash(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"} will be deleted permanently.`;
}

export function describeOriginalFolder(originalPath: readonly string[]): string {
  return originalPath.length <= 1
    ? "Notes (top level)"
    : originalPath.slice(0, -1).join(" / ");
}

export function describeMovedToTrash(name: string): string {
  return `“${name}” moved to trash`;
}

export function describeUndoError(error: StructureError): string {
  return error.kind === "invalidName"
    ? "Couldn't undo: an item with that name already exists there. It is still in the trash."
    : "Couldn't undo: the item or its original folder no longer exists. Check the trash.";
}
