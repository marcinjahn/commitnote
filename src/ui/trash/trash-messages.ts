import type { StructureError } from "../../sync/sync-engine";
import { TRASH_RETENTION_MS } from "../../format/v1";
import { plural } from "../plural";

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

export function describeMovedNotesToTrash(count: number): string {
  return `${plural(count, "note", "notes")} moved to trash`;
}

export function describeSharedNotesKept(count: number): string {
  return `${plural(count, "shared note", "shared notes")} kept.`;
}

export function describeUndoneFileDrop(trashed: number, kept: number): string {
  if (kept === 0) return describeMovedNotesToTrash(trashed);
  if (trashed === 0) return describeSharedNotesKept(kept);
  return `${describeMovedNotesToTrash(trashed)}. ${describeSharedNotesKept(kept)}`;
}

export function describeUndoError(error: StructureError): string {
  return error.kind === "invalidName"
    ? "Couldn't undo: an item with that name already exists there. It is still in the trash."
    : "Couldn't undo: the item or its original folder no longer exists. Check the trash.";
}

function shareLinks(count: number): string {
  return plural(count, "active share link", "active share links");
}

export function describeSharesRevokedOnTrash(
  count: number,
  itemKind: "note" | "folder",
): string {
  const pronoun = count === 1 ? "it" : "them";
  const owner =
    itemKind === "note"
      ? `This note has ${shareLinks(count)}.`
      : `Notes in this folder have ${shareLinks(count)}.`;
  return `${owner} Moving it to the trash revokes ${pronoun} permanently. Restoring it won't bring ${pronoun} back.`;
}

export function describeRevokeFailed(reason: string, revoked: number): string {
  const done =
    revoked === 0
      ? ""
      : ` ${plural(revoked, "link was", "links were")} already revoked.`;
  return `${reason} Nothing was moved to the trash.${done}`;
}

export const DELETE_PERMANENTLY_TITLE = "Delete permanently?";
export const DELETE_PERMANENTLY_MESSAGE = "This can't be undone.";
export const EMPTY_TRASH_TITLE = "Empty trash?";

export interface TrashConfirmationInput {
  readonly name: string;
  readonly kind: "note" | "folder";
  readonly itemCount: number;
  readonly shareCount: number;
  readonly revoking: boolean;
}

export interface TrashConfirmation {
  readonly title: string;
  readonly body: string;
  readonly shareWarning: string | null;
  readonly retentionNote: string | null;
  readonly confirmLabel: string;
}

export function describeTrashConfirmation(
  input: TrashConfirmationInput,
): TrashConfirmation {
  const { name, kind, itemCount, shareCount, revoking } = input;
  const nonEmptyFolder = kind === "folder" && itemCount > 0;
  const toTrash = kind === "note" || nonEmptyFolder;
  const items = `${itemCount} ${itemCount === 1 ? "item" : "items"}`;
  return {
    title: toTrash ? "Move to trash?" : "Delete folder?",
    body:
      kind === "note"
        ? `“${name}” will be moved to the trash.`
        : nonEmptyFolder
          ? `“${name}” and everything in it (${items}) will be moved to the trash.`
          : `“${name}” will be deleted.`,
    shareWarning:
      shareCount > 0 ? describeSharesRevokedOnTrash(shareCount, kind) : null,
    retentionNote: toTrash
      ? "Items in the trash are deleted permanently after 30 days."
      : null,
    confirmLabel: revoking
      ? "Revoking links…"
      : shareCount > 0
        ? "Revoke links and move to trash"
        : toTrash
          ? "Move to trash"
          : "Delete",
  };
}
