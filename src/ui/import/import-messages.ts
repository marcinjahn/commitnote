import type { DropSkipCounts } from "../../import/read-dropped-files";
import type { ImportResult } from "../../sync/sync-engine";
import type {
  ArchiveSkipCounts,
  NotesArchiveErrorKind,
} from "../../import/read-notes-archive";
import { validateName } from "../../tree/note-names";
import { plural } from "../plural";
import { countDropSkipped } from "../../import/read-dropped-files";
import type { ImportSummary } from "../../import/plan-import";
import { ROOT_FOLDER_LABEL } from "../dialogs/folder-options";

export const FALLBACK_IMPORT_FOLDER_NAME = "Imported notes";

export function defaultImportFolderName(fileName: string): string {
  const stem = fileName.replace(/\.zip$/i, "").trim();
  const validation = validateName(stem, []);
  return validation.ok ? validation.name : FALLBACK_IMPORT_FOLDER_NAME;
}

export function countSkipped(skipped: ArchiveSkipCounts): number {
  return (
    skipped.unsupported +
    skipped.unsafePath +
    skipped.reserved +
    skipped.invalidName +
    skipped.invalidEncoding
  );
}

export function describeImportCounts(notes: number, folders: number): string {
  return `${plural(notes, "note", "notes")} and ${plural(folders, "folder", "folders")}`;
}

export const IMPORT_DIALOG_TITLE = "Import notes";
export const IMPORT_CONFLICTS_TITLE = "Name conflicts";
export const IMPORT_SETUP_TITLE = "Project setting needed";
export const IMPORT_INTO_LABEL = "Import into";
export const IMPORT_NEW_FOLDER_LABEL = "A new folder";
export const IMPORT_FOLDER_NAME_LABEL = "Folder name";
export const IMPORT_EXISTING_FOLDER_LABEL = "An existing folder";
export const IMPORT_ROOT_FOLDER_LABEL = ROOT_FOLDER_LABEL;
export const IMPORT_EMPTY_TEXT = "The archive has no notes to import.";
export const IMPORT_LABEL = "Import";
export const IMPORTING_LABEL = "Importing…";
export const IMPORT_RENAME_LABEL = "Rename imported items";
export const IMPORT_BACK_LABEL = "Back";
export const IMPORT_CONFLICTS_HINT =
  "Rename the imported items to keep both, for example “Ideas (2)”, or cancel the import.";

export function describeImportPreview(
  summary: Pick<ImportSummary, "notes" | "folders">,
): string {
  return `Imports ${describeImportCounts(summary.notes, summary.folders)}.`;
}

export const IMPORT_MIXED_FILES_MESSAGE =
  "Choose one .zip archive, or Markdown and text files.";

export const IMPORT_DESTINATION_GONE_MESSAGE =
  "The destination folder no longer exists.";

export const IMPORT_IMAGES_FAILED_MESSAGE =
  "Couldn't prepare the images in this archive. Try again.";

export function describeImportUnreachable(forgeName: string): string {
  return `Could not reach ${forgeName}. Try again later.`;
}

export function describeSkipped(skipped: number): string | null {
  if (skipped === 0) return null;
  return `${plural(skipped, "file", "files")} will be skipped: only Markdown (.md) files with valid names are imported.`;
}

export function describeImportConflicts(conflicts: number): string {
  return conflicts === 1
    ? "1 imported item has the same name as an item already in the destination."
    : `${conflicts} imported items have the same name as items already in the destination.`;
}

export function describeArchiveError(kind: NotesArchiveErrorKind): string {
  switch (kind) {
    case "invalidArchive":
      return "Couldn't import: the file is not a valid zip archive.";
    case "tooManyEntries":
      return "Couldn't import: the archive has too many files.";
    case "tooLarge":
      return "Couldn't import: the archive is too large.";
  }
}

export function describeImportRefusal(
  reason: Extract<ImportResult, { ok: false }>["reason"],
): string {
  switch (reason) {
    case "unavailable":
      return "Notes can't be imported right now.";
    case "unsaved":
      return "Your earlier changes aren't saved yet. Try importing again once they are.";
    case "outdated":
      return "Your notes changed while importing. Try again.";
  }
}

export interface ImportedImageCounts {
  added: number;
  failed: number;
}

export function describeImportDone(
  notes: number,
  folders: number,
  images: ImportedImageCounts = { added: 0, failed: 0 },
): string {
  let message = `Imported ${describeImportCounts(notes, folders)}.`;
  if (images.added > 0) {
    message += ` Added ${plural(images.added, "image", "images")}.`;
  }
  if (images.failed > 0) {
    message +=
      images.failed === 1
        ? " 1 image could not be imported and stays as a link."
        : ` ${images.failed} images could not be imported and stay as links.`;
  }
  return message;
}

export const IMPORT_RETRYING_MESSAGE =
  "The import isn't saved yet. It will be retried automatically.";

export function describeAtomicSetup(
  forgeName: string,
  canConfigure: boolean,
): string {
  const need = `Imports are saved as a single commit, which needs the ${forgeName} project to use the “Fast-forward merge” method.`;
  return canConfigure
    ? `${need} commitnote can switch the project's merge method for you.`
    : `${need} Ask a project Maintainer to change it in the project's merge request settings, then try again.`;
}

export const ENABLE_ATOMIC_LABEL = "Use fast-forward merges";

export const IMPORT_BLOCKED_TITLE = "Import not saved";

export const SAVE_WITHOUT_ATOMIC_LABEL = "Save without it";

export const IMPORT_BLOCKED_KEPT =
  "The import and any later changes are kept on this device and will be saved once this is resolved.";

export const SAVE_WITHOUT_ATOMIC_HINT =
  "You can also save it now without the single-commit guarantee. That is how other changes are saved, and it can rarely clash with a save from another device at the same moment.";

export function describeEnableAtomicFailure(forgeName: string): string {
  return `Couldn't change the ${forgeName} project settings. Try again later.`;
}

export function describeDropSkipped(skipped: DropSkipCounts): string | null {
  const total = countDropSkipped(skipped);
  if (total === 0) return null;
  const parts = [
    skipped.folders > 0 &&
      `${skipped.folders} ${skipped.folders === 1 ? "folder" : "folders"}`,
    skipped.unsupported > 0 &&
      `${skipped.unsupported} not .md, .markdown or .txt`,
    skipped.invalidEncoding > 0 && `${skipped.invalidEncoding} not UTF-8 text`,
    skipped.invalidName > 0 && `${skipped.invalidName} with an invalid name`,
    skipped.tooLarge > 0 && `${skipped.tooLarge} over 1 MiB`,
    skipped.tooMany > 0 && `${skipped.tooMany} over the 100-file limit`,
  ].filter((part) => part !== false);
  return `Skipped ${plural(total, "file", "files")}: ${parts.join(", ")}.`;
}

function withDropSkipped(message: string, skipped: DropSkipCounts): string {
  const skippedMessage = describeDropSkipped(skipped);
  return skippedMessage === null ? message : `${message} ${skippedMessage}`;
}

export function describeFileDropDone(
  notes: number,
  skipped: DropSkipCounts,
): string {
  return withDropSkipped(`Imported ${plural(notes, "note", "notes")}.`, skipped);
}

export function describeNothingDropped(skipped: DropSkipCounts): string {
  return withDropSkipped("No notes imported.", skipped);
}
