import type { LoginError, LoginStep } from "../../login/login";

export const GENERIC_LOGIN_ERROR = "Something went wrong. Try again.";

export function describeLoginError(
  error: LoginError,
  forgeName: string,
): string {
  switch (error.kind) {
    case "unauthorized":
      return "The access token is invalid or has expired.";
    case "noAccess":
      return "The repository was not found, or the access token has no access to it.";
    case "rateLimited": {
      const minutes = Math.max(1, Math.ceil(error.retryAfterMs / 60000));
      return `${forgeName}'s rate limit was reached. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "network":
      return `Could not reach ${forgeName}. Check your connection and try again.`;
    case "server":
      return `${forgeName} returned an error. Try again later.`;
    case "readOnly":
      return 'This access token cannot write to the repository. Give it read and write access to the repository contents.';
    case "foreign":
      return "This repository is neither empty nor a notes repo. commitnote only uses an empty repository or one it initialized, and it has not changed anything here.";
    case "newerFormat":
      return "This notes repo was created by a newer version of commitnote. Update the app to open it.";
    case "wrongPassphrase":
      return "Wrong passphrase.";
    case "initializationRaced":
      return "The repository changed while it was being initialized. Log in again.";
  }
}

export function describeLoginStep(step: LoginStep): string {
  switch (step) {
    case "listingRepositories":
      return "Loading repositories…";
    case "checkingRepository":
      return "Checking repository…";
    case "derivingKeys":
      return "Deriving keys from your passphrase…";
    case "initializing":
      return "Initializing notes repo…";
  }
}
