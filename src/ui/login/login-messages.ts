import type { LoginError, LoginStep } from "../../login/login";
import type { RepoUrlError } from "../../repo-url/parse-repo-url";

export const GENERIC_LOGIN_ERROR = "Something went wrong. Try again.";

function describeRepoUrlError(error: RepoUrlError): string {
  switch (error.kind) {
    case "malformed":
      return "That doesn't look like a repo URL. Use the form https://github.com/owner/repo.";
    case "unsupportedForge":
      return `Only github.com repositories are supported, not ${error.host}.`;
  }
}

export function describeLoginError(error: LoginError): string {
  switch (error.kind) {
    case "repoUrl":
      return describeRepoUrlError(error.error);
    case "unauthorized":
      return "The access token is invalid or has expired.";
    case "noAccess":
      return "The repository was not found, or the access token has no access to it.";
    case "rateLimited": {
      const minutes = Math.max(1, Math.ceil(error.retryAfterMs / 60000));
      return `GitHub's rate limit was reached. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "network":
      return "Could not reach GitHub. Check your connection and try again.";
    case "server":
      return "GitHub returned an error. Try again later.";
    case "readOnly":
      return 'This access token cannot write to the repository. Give it "Contents: read and write" access.';
    case "foreign":
      return "This repository is neither empty nor a notes repo. git-notes only uses an empty repository or one it initialized, and it has not changed anything here.";
    case "newerFormat":
      return "This notes repo was created by a newer version of git-notes. Update the app to open it.";
    case "wrongPassphrase":
      return "Wrong passphrase.";
    case "initializationRaced":
      return "The repository changed while it was being initialized. Log in again.";
  }
}

export function describeLoginStep(step: LoginStep): string {
  switch (step) {
    case "checkingRepository":
      return "Checking repository…";
    case "derivingKeys":
      return "Deriving keys from your passphrase…";
    case "initializing":
      return "Initializing notes repo…";
  }
}
