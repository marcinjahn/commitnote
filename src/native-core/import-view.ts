import type { NotePath } from "../changes/change";
import type { NotesArchiveContents } from "../import/read-notes-archive";
import type { SyncEngineState } from "../sync/sync-engine";
import type { WorkingTree } from "../sync/working-tree";
import { listMoveTargets } from "../ui/dialogs/folder-options";
import {
  countSkipped,
  defaultImportFolderName,
  describeAtomicSetup,
  describeImportConflicts,
  describeSkipped,
  ENABLE_ATOMIC_LABEL,
  IMPORT_BLOCKED_KEPT,
  IMPORT_BLOCKED_TITLE,
  IMPORT_CONFLICTS_TITLE,
  IMPORT_DIALOG_TITLE,
  IMPORT_EMPTY_TEXT,
  IMPORT_EXISTING_FOLDER_LABEL,
  IMPORT_FOLDER_NAME_LABEL,
  IMPORT_INTO_LABEL,
  IMPORT_LABEL,
  IMPORT_NEW_FOLDER_LABEL,
  IMPORT_RENAME_LABEL,
  IMPORT_ROOT_FOLDER_LABEL,
  IMPORT_SETUP_TITLE,
  IMPORTING_LABEL,
  SAVE_WITHOUT_ATOMIC_HINT,
  SAVE_WITHOUT_ATOMIC_LABEL,
} from "../ui/import/import-messages";
import type { ImportOutcome } from "../ui/import/import-outcome";
import type {
  AtomicBlockedView,
  ImportForm,
  ImportFormCopy,
  ImportOutcomeView,
} from "./api";
import type { AppSession } from "./app-session";
import { importStateOf } from "./import-state";

const IMPORT_CANCEL_LABEL = "Cancel";

const IMPORT_FORM_COPY: ImportFormCopy = {
  title: IMPORT_DIALOG_TITLE,
  conflictsTitle: IMPORT_CONFLICTS_TITLE,
  setupTitle: IMPORT_SETUP_TITLE,
  intoLabel: IMPORT_INTO_LABEL,
  newFolderLabel: IMPORT_NEW_FOLDER_LABEL,
  folderNameLabel: IMPORT_FOLDER_NAME_LABEL,
  existingFolderLabel: IMPORT_EXISTING_FOLDER_LABEL,
  rootLabel: IMPORT_ROOT_FOLDER_LABEL,
  emptyText: IMPORT_EMPTY_TEXT,
  importLabel: IMPORT_LABEL,
  importingLabel: IMPORTING_LABEL,
  renameLabel: IMPORT_RENAME_LABEL,
  enableAtomicLabel: ENABLE_ATOMIC_LABEL,
  cancelLabel: IMPORT_CANCEL_LABEL,
};

export function toImportForm(
  fileName: string,
  contents: NotesArchiveContents,
  tree: WorkingTree,
): ImportForm {
  return {
    fileName,
    defaultFolderName: defaultImportFolderName(fileName),
    skipped: describeSkipped(countSkipped(contents.skipped)),
    empty: contents.entries.length === 0,
    targets: listMoveTargets(tree, null, "folder").map((target) => ({
      path: [...target.path],
      label: target.label,
      depth: target.depth,
    })),
    copy: { ...IMPORT_FORM_COPY },
  };
}

export function toImportOutcomeView(
  outcome: ImportOutcome,
  forgeName: string,
  expand: NotePath | null,
): ImportOutcomeView {
  switch (outcome.kind) {
    case "queued":
      return { kind: "queued", expand: expand === null ? null : [...expand] };
    case "conflicts":
      return {
        kind: "conflicts",
        count: outcome.count,
        message: describeImportConflicts(outcome.count),
      };
    case "needsSetup":
      return {
        kind: "needsSetup",
        canConfigure: outcome.canConfigure,
        message: describeAtomicSetup(forgeName, outcome.canConfigure),
        actionLabel: ENABLE_ATOMIC_LABEL,
      };
    case "error":
      return { kind: "error", message: outcome.message };
  }
}

export function toAtomicBlockedView(
  blocked: SyncEngineState["atomicBlocked"],
  forgeName: string,
): AtomicBlockedView | null {
  if (blocked === null) return null;
  return {
    title: IMPORT_BLOCKED_TITLE,
    message: [
      describeAtomicSetup(forgeName, blocked.canConfigure),
      IMPORT_BLOCKED_KEPT,
      SAVE_WITHOUT_ATOMIC_HINT,
    ].join("\n\n"),
    enableLabel: ENABLE_ATOMIC_LABEL,
    saveWithoutLabel: SAVE_WITHOUT_ATOMIC_LABEL,
    canConfigure: blocked.canConfigure,
  };
}

export function importBusy(app: AppSession): boolean {
  const state = importStateOf(app);
  return state.starting > 0 || state.started !== null;
}
