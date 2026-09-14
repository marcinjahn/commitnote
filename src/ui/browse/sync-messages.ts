import type { SyncError } from "../../sync/sync-engine";
import type { SyncState } from "../../sync/sync-state";

export const KEY_CHANGED_MESSAGE =
  "The passphrase was changed on another device. Log in again.";

export function describeSyncState(state: SyncState): string {
  switch (state.kind) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing";
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
      const minutes = Math.max(1, Math.ceil(error.retryAfterMs / 60000));
      return `${forgeName}'s rate limit was reached. Refresh again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
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
