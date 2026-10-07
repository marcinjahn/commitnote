import type {
  HistoryOutcome,
  LandedCheck,
  PassphraseChangeFailure,
  PassphraseChangeStep,
} from "../../rekey/change-passphrase";
import type { RekeySummary } from "../../rekey/plan-rekey";
import type { SyncError } from "../../sync/sync-engine";
import { KEY_CHANGED_MESSAGE } from "../browse/sync-messages";
import { describeMinutes, plural } from "../plural";

export const PASSPHRASE_CHANGED_MESSAGE = "Passphrase changed.";
export const PASSPHRASE_CHANGED_MISMATCH_MESSAGE =
  "Passphrase changed, but the files saved differ from the ones checked before saving. Export your notes and look them over.";
export const HISTORY_REMOVED_MESSAGE =
  "Passphrase changed and the old history deleted.";
export const HISTORY_NOT_REMOVED_MESSAGE =
  "The old history couldn't be deleted, so it still holds earlier versions of your notes that the old passphrase decrypts. To delete it, change the passphrase again with that option selected.";

export function describePassphraseChanged(
  check: LandedCheck,
  history: HistoryOutcome,
): string {
  if (check === "mismatch") {
    return history === "notRemoved"
      ? `${PASSPHRASE_CHANGED_MISMATCH_MESSAGE} ${HISTORY_NOT_REMOVED_MESSAGE}`
      : PASSPHRASE_CHANGED_MISMATCH_MESSAGE;
  }
  switch (history) {
    case "kept":
      return PASSPHRASE_CHANGED_MESSAGE;
    case "removed":
      return HISTORY_REMOVED_MESSAGE;
    case "notRemoved":
      return `${PASSPHRASE_CHANGED_MESSAGE} ${HISTORY_NOT_REMOVED_MESSAGE}`;
  }
}
export const PASSPHRASES_DIFFER = "The new passphrases do not match.";
export const ENTER_CURRENT_PASSPHRASE = "Enter the current passphrase.";

export const CHANGE_PASSPHRASE_INTRO =
  "Change your passphrase if someone else may know it, or to switch to a stronger one. Your notes are re-encrypted so only the new passphrase opens them from now on.";
export const VERSION_HISTORY_NOTICE =
  "Version history starts over: commitnote can't show or restore versions of your notes from before the change.";
export const HISTORY_WARNING =
  "Earlier versions of your notes stay in the repository's history, so the current passphrase still decrypts them after the change, though commitnote can no longer restore them.";
export const REMOVE_HISTORY_LABEL = "Also delete the old history";

export function describeRemoveHistory(forgeName: string): string {
  return `Every earlier version of your notes stays in the repository's history, encrypted with the passphrase that was current back then. Selecting this replaces the whole history with the one commit of re-encrypted notes, so earlier versions and older passphrases no longer unlock anything in it. It can't be undone and the notes' change history is lost. Copies made before, such as clones or forks, keep the old history, and ${forgeName} may keep old commits reachable by their direct link for a while.`;
}

export const REMOVE_HISTORY_REVIEW =
  "Afterwards, the repository's history is replaced with just that commit. All earlier versions of your notes are deleted for good.";

export const OTHER_DEVICES_WARNING =
  "Other devices are signed out and must log in with the new passphrase. Reload commitnote in any other open tabs.";
export const NEW_PASSPHRASE_HINT =
  "Use a long passphrase, for example several random words. It cannot be recovered.";

const NOTHING_CHANGED = "Nothing was changed.";

export function describeChangeStep(step: PassphraseChangeStep): string {
  switch (step.kind) {
    case "saving":
      return "Saving your changes…";
    case "checkingPassphrase":
      return "Checking the current passphrase…";
    case "derivingKeys":
      return "Deriving keys from the new passphrase…";
    case "reading":
      return `Reading notes (${step.done} of ${step.total})…`;
    case "encrypting":
      return `Re-encrypting (${step.done} of ${step.total})…`;
    case "verifying":
      return "Checking the re-encrypted notes…";
    case "waitingForBudget":
      return "Waiting before saving, to stay within the request limit…";
    case "uploading":
      return "Saving the re-encrypted notes…";
    case "confirming":
      return "Checking whether the change was saved…";
    case "removingHistory":
      return "Deleting the old history…";
  }
}

export function describeRekeySummary(summary: RekeySummary): string {
  const parts = [
    plural(summary.notes, "note", "notes"),
    plural(summary.folders, "folder", "folders"),
  ];
  if (summary.trashEntries > 0) {
    parts.push(
      plural(summary.trashEntries, "item in the trash", "items in the trash"),
    );
  }
  const last = parts.pop();
  return `Re-encrypts ${parts.join(", ")} and ${last} with the new passphrase, saved as a single commit.`;
}

export function describeCarriedOver(summary: RekeySummary): string[] {
  const lines: string[] = [];
  if (summary.carriedTrashEntries > 0) {
    lines.push(
      summary.carriedTrashEntries === 1
        ? "1 item in the trash can't be decrypted and is kept as it is."
        : `${summary.carriedTrashEntries} items in the trash can't be decrypted and are kept as they are.`,
    );
  }
  if (summary.carriedFiles > 0) {
    lines.push(
      summary.carriedFiles === 1
        ? "1 file that isn't a note, such as a README, is kept as it is."
        : `${summary.carriedFiles} files that aren't notes, such as a README, are kept as they are.`,
    );
  }
  return lines;
}

export function describeChangeAtomicSetup(
  forgeName: string,
  canConfigure: boolean,
): string {
  const need = `The passphrase change is saved as a single commit, which needs the ${forgeName} project to use the “Fast-forward merge” method.`;
  return canConfigure
    ? `${need} commitnote can switch the project's merge method for you.`
    : `${need} Ask a project Maintainer to change it in the project's merge request settings, then try again.`;
}

function describeForgeError(error: SyncError, forgeName: string): string {
  switch (error.kind) {
    case "unauthorized":
      return "Your access token is no longer valid.";
    case "forbidden":
    case "notFound":
      return "The notes repo is no longer accessible with this access token.";
    case "rateLimited": {
      return `${forgeName}'s rate limit was reached. Try again in ${describeMinutes(error.retryAfterMs)}.`;
    }
    case "network":
      return `Could not reach ${forgeName}. Check your connection and try again.`;
    case "server":
      return `${forgeName} returned an error. Try again later.`;
    case "treeTruncated":
      return "This notes repo is too large to load.";
    case "undecryptable":
      return "A note could not be decrypted.";
    case "keyChanged":
      return KEY_CHANGED_MESSAGE;
  }
}

export function describeChangeFailure(
  failure: PassphraseChangeFailure,
  forgeName: string,
  now: number,
): string {
  switch (failure.kind) {
    case "emptyPassphrase":
      return "Enter a new passphrase.";
    case "samePassphrase":
      return "The new passphrase is the same as the current one.";
    case "unavailable":
      return "The passphrase can't be changed right now. Refresh and try again.";
    case "unsaved":
      return failure.count === 1
        ? "1 change isn't saved yet. Try again once it is."
        : `${failure.count} changes aren't saved yet. Try again once they are.`;
    case "conflicts":
      return "Resolve the conflicting notes first, then try again.";
    case "wrongPassphrase":
      return "The current passphrase is wrong.";
    case "changedElsewhere":
      return `Your notes changed on another device in the meantime. ${NOTHING_CHANGED} Try again.`;
    case "undecryptableNote":
      return `A note can't be decrypted with the current passphrase, so it can't be re-encrypted. ${NOTHING_CHANGED}`;
    case "invalidName":
      return `A name can't be re-encrypted. ${NOTHING_CHANGED}`;
    case "verificationFailed":
      return `The re-encrypted notes didn't pass the final check. ${NOTHING_CHANGED}`;
    case "outcomeUnknown":
      return "Couldn't confirm whether the passphrase was changed. Editing is paused until that is known, so check again in a moment. If you log out instead, try the new passphrase first when logging in.";
    case "needsSetup":
      return describeChangeAtomicSetup(forgeName, failure.canConfigure);
    case "rateBudget": {
      return `commitnote is pacing its requests to ${forgeName}. ${NOTHING_CHANGED} Try again in ${describeMinutes(failure.retryAt - now)}.`;
    }
    case "forge":
      return `${describeForgeError(failure.error, forgeName)} ${NOTHING_CHANGED}`;
  }
}
