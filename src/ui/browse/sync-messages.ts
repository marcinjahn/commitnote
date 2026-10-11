import type { SyncError } from "../../sync/sync-engine";
import type { SyncState } from "../../sync/sync-state";
import { describeMinutes } from "../plural";

export const KEY_CHANGED_MESSAGE =
  "The passphrase was changed on another device. Log in again.";

export function describeSyncState(state: SyncState): string {
  switch (state.kind) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Saving";
    case "out-of-sync":
      switch (state.reason) {
        case "pending":
          return "Out of sync: waiting to save";
        case "failed":
          return "Out of sync: saving failed, will retry";
        case "conflict":
          return "Out of sync: conflict, needs your decision";
      }
  }
}

export function describeOffline(hasUnsaved: boolean): string {
  return hasUnsaved
    ? "Offline. Changes will save when you're back online. Keep this tab open."
    : "Offline";
}

export function describeSaveShortcutResult(input: {
  stopped: boolean;
  suspended: boolean;
  unsavedCount: number;
  settingsPending: boolean;
  offline: boolean;
  waitingForRateBudget: boolean;
}): string | null {
  if (input.stopped || input.suspended) return null;
  if (input.unsavedCount === 0 && !input.settingsPending) return "All saved";
  if (input.offline) return describeOffline(true);
  if (input.waitingForRateBudget) return "Saving soon (commit limit reached)";
  return null;
}

export function describeSyncStatus(input: {
  state: SyncState;
  offline: boolean;
  hasUnsaved: boolean;
}): string {
  return input.offline
    ? describeOffline(input.hasUnsaved)
    : describeSyncState(input.state);
}

export function describeSyncError(
  error: SyncError,
  forgeName: string,
): string {
  switch (error.kind) {
    case "unauthorized":
      return "Your access token is no longer valid. Log out and log in again.";
    case "forbidden":
    case "notFound":
      return "The notes repo is no longer accessible with this access token.";
    case "rateLimited": {
      return `${forgeName}'s rate limit was reached. Refresh again in ${describeMinutes(error.retryAfterMs)}.`;
    }
    case "network":
      return `Could not reach ${forgeName}. Showing the last loaded notes.`;
    case "server":
      return `${forgeName} returned an error. Try Refresh again later.`;
    case "treeTruncated":
      return "This notes repo is too large to load.";
    case "undecryptable":
      return "This note could not be decrypted.";
    case "keyChanged":
      return KEY_CHANGED_MESSAGE;
  }
}

export function describeUndecryptableFiles(count: number): string {
  return count === 1
    ? "1 file can't be decrypted with this passphrase and is not shown."
    : `${count} files can't be decrypted with this passphrase and are not shown.`;
}
