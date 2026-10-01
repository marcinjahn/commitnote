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
      return "This repository has files commitnote does not use. commitnote accepts an empty repository, one with only a README, LICENSE or .gitignore, or a notes repo. Nothing was changed here.";
    case "noMainBranch":
      return "commitnote needs a branch named main, and this repository has none. Nothing was changed here.";
    case "newerFormat":
      return "This notes repo was created by a newer version of commitnote. Update the app to open it.";
    case "wrongPassphrase":
      return "Wrong passphrase.";
    case "initializationRaced":
      return "The repository changed while it was being set up. Check it again.";
    case "repositoryChanged":
      return "The repository changed since it was checked. Check it again.";
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
      return "Setting up notes repo…";
  }
}

export const PUBLIC_REPOSITORY_WARNING =
  "This repository is not private. Your notes stay encrypted, but anyone who can see the repository can see when you save, how many files there are, their sizes and how often you write.";

function listNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeSetUp(pending: {
  readonly base: { readonly hasReadme: boolean } | null;
  readonly existingFiles: readonly string[];
}): string {
  if (pending.base === null || pending.existingFiles.length === 0) {
    return "This repository is empty. Setting it up as a notes repo adds a commitnote configuration file and a README.";
  }
  const files = pending.existingFiles;
  const pronoun = files.length === 1 ? "it" : "them";
  const added = pending.base.hasReadme
    ? "a commitnote configuration file"
    : "a commitnote configuration file and a README";
  return `This repository holds only ${listNames(files)}. Setting it up as a notes repo keeps ${pronoun} as ${files.length === 1 ? "it is" : "they are"} and adds ${added}.`;
}
