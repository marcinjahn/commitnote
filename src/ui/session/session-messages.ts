export const LOGGING_OUT_TITLE = "Logging out";
export const LOGOUT_SAVING_TEXT = "Saving…";
export const LOGOUT_UNSAVED_TITLE = "Some changes are not saved";
export const KEEP_TRYING_LABEL = "Keep trying";
export const LOG_OUT_ANYWAY_LABEL = "Log out anyway";
export const PASSPHRASE_CHANGED_TITLE = "Passphrase changed";
export const EXPORTING_LABEL = "Exporting…";
export const EXPORT_FAILED_MESSAGE = "Export failed. Try again.";
export const LOG_IN_AGAIN_LABEL = "Log in again";

export function describeLogoutUnsaved(count: number): string {
  return `${count} ${count === 1 ? "note or folder is" : "notes or folders are"} not saved yet. If you log out now, these changes are lost.`;
}

export function exportNotesLabel(unsavedCount: number): string {
  return unsavedCount > 0 ? "Export unsaved notes" : "Export notes";
}
