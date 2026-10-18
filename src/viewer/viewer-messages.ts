import type { ViewerErrorKind } from "./viewer-state";

export const VIEWER_TITLE = "Shared note · commitnote";
export const LOADING_TEXT = "Opening shared note…";
export const PASSWORD_HEADING = "This note is protected with a password";
export const WRONG_PASSWORD_TEXT = "Wrong password";
export const UNLOCK_LABEL = "Unlock";
export const UNLOCKING_LABEL = "Unlocking…";
const PROVIDER_NAMES = { github: "GitHub", gitlab: "GitLab" } as const;

export function footerText(standalone: boolean): string {
  return standalone
    ? "End-to-end encrypted. Decrypted on this device."
    : "End-to-end encrypted. Decrypted in your browser.";
}

export function describeViewerError(
  error: ViewerErrorKind,
  provider: "github" | "gitlab" | null,
  standalone: boolean,
): string {
  const host = provider ? PROVIDER_NAMES[provider] : "the host";
  switch (error) {
    case "invalid":
    case "damaged":
      return "This link is incomplete or damaged. Ask for the link again.";
    case "notFound":
      return "This shared note is no longer available. It was removed by its owner, or the link is wrong.";
    case "rateLimited":
      return `${host} is limiting requests from your network. Try again in a few minutes.`;
    case "network":
      return `Couldn't reach ${host}. Check your connection.`;
    case "server":
      return `${host} isn't responding right now. Try again in a moment.`;
    case "unsupported":
      return standalone
        ? "This device can't open encrypted notes."
        : "This browser can't open encrypted notes.";
  }
}
