import type { SyncError } from "../../sync/sync-engine";

export function describeSyncError(error: SyncError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Your access token is no longer valid. Log out and log in again.";
    case "forbidden":
    case "notFound":
      return "The notes repo is no longer accessible with this access token.";
    case "rateLimited": {
      const minutes = Math.max(1, Math.ceil(error.retryAfterMs / 60000));
      return `GitHub's rate limit was reached. Refresh again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "network":
      return "Could not reach GitHub. Showing the last loaded notes.";
    case "server":
      return "GitHub returned an error. Try Refresh again later.";
    case "treeTruncated":
      return "This notes repo is too large to load.";
    case "undecryptable":
      return "This note could not be decrypted.";
  }
}
