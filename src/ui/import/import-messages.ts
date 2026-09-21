import type { ImportResult } from "../../sync/sync-engine";
import type {
  ArchiveSkipCounts,
  NotesArchiveErrorKind,
} from "../../import/read-notes-archive";
import { validateName } from "../../tree/note-names";

export const FALLBACK_IMPORT_FOLDER_NAME = "Imported notes";

export function defaultImportFolderName(fileName: string): string {
  const stem = fileName.replace(/\.zip$/i, "").trim();
  const validation = validateName(stem, []);
  return validation.ok ? validation.name : FALLBACK_IMPORT_FOLDER_NAME;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
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

export function describeImportDone(notes: number, folders: number): string {
  return `Imported ${describeImportCounts(notes, folders)}.`;
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

export const IMPORT_BLOCKED_KEPT =
  "The import and any later changes are kept on this device and will be saved once this is resolved.";

export const SAVE_WITHOUT_ATOMIC_HINT =
  "You can also save it now without the single-commit guarantee. That is how other changes are saved, and it can rarely clash with a save from another device at the same moment.";

export function describeEnableAtomicFailure(forgeName: string): string {
  return `Couldn't change the ${forgeName} project settings. Try again later.`;
}
