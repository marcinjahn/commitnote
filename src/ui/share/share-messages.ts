import type { ForgeId } from "../../forge/repo-coordinates";
import { MAX_SHARE_LABEL_LENGTH } from "../../share/share-label";
import type { ShareError, UpdateShareResult } from "../../share/share-service";

export type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

const MINUTE_MS = 60_000;

const FORGE_NAMES: Readonly<Record<ForgeId, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
};

export const SHARE_UPDATED_TEXT = "Link updated";
export const SHARE_UNCHANGED_TEXT = "Link already shows the current version";

export const SHARE_LABEL_FIELD = "Name (optional)";
export const SHARE_PASSWORD_FIELD = "Password (optional)";
export const SHARE_PASSWORD_HINT =
  "The recipient needs the link and this password. Send the password separately.";
export const CREATE_LINK_LABEL = "Create link";
export const CREATING_LINK_LABEL = "Creating link…";
export const CREATE_ANOTHER_LINK_LABEL = "Create another link";
export const SHARE_LINK_LABEL = "Share link";
export const SHARE_PASSWORD_LABEL = "Share password";
export const COPY_LINK_LABEL = "Copy link";
export const COPY_PASSWORD_LABEL = "Copy password";
export const SHARED_LINKS_TITLE = "Shared links";
export const SHARED_LINKS_EMPTY =
  "No shared links yet. Share a note from its menu.";
export const PASSWORD_PROTECTED_LABEL = "Password protected";
export const UPDATING_LABEL = "Updating…";
export const LINK_COPIED_TEXT = "Link copied";
export const PASSWORD_COPIED_TEXT = "Password copied";
export const COPY_FAILED_TEXT = "Couldn't copy. Select the text and copy it.";
export const LINK_REVOKED_TEXT = "Link revoked";
export const REVOKE_LINK_TITLE = "Revoke link?";
export const REVOKE_LINK_MESSAGE =
  "The link will stop working. People who already opened it may have kept a copy.";
export const REVOKE_LINK_CONFIRM = "Revoke";
export const RENAME_LINK_TITLE = "Rename link";
export const RENAME_LINK_FIELD = "Name";
export const RENAME_LINK_CONFIRM = "Rename";
export const SHARED_VERSION_TITLE = "Shared version";
export const LOADING_SHARED_VERSION_TEXT = "Loading shared version…";
export const SHARED_VERSION_GONE_MESSAGE =
  "The shared version is no longer in your history. The link still works.";
export const SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE =
  "The shared version is no longer in your history. Your passphrase was changed after this note was shared. The link still works.";
export const TRY_AGAIN_LABEL = "Try again";

export function shareDialogTitle(noteName: string): string {
  return `Share “${noteName}”`;
}

export function shareExplanation(forgeId: ForgeId): string {
  return forgeId === "github"
    ? "Creates an encrypted copy of the saved version of this note as a secret gist on your GitHub account. Anyone with the link can read it. Later edits are not included. Your username is visible on the gist."
    : "Creates an encrypted copy of the saved version of this note as a public snippet on your GitLab account. Anyone with the link can read it. Later edits are not included. Your username is visible on the snippet.";
}

export function shareActionsLabel(title: string): string {
  return `Share actions for ${title}`;
}

const text = (value: string): MessagePart => ({ kind: "text", text: value });
const link = (label: string, href: string): MessagePart => ({
  kind: "link",
  text: label,
  href,
});

function permissionMissing(providerId: ForgeId): readonly MessagePart[] {
  if (providerId === "github") {
    return [
      text(
        "Sharing needs permission to create gists, and your access token doesn't have it. Fine-grained token: open ",
      ),
      link(
        "github.com/settings/personal-access-tokens",
        "https://github.com/settings/personal-access-tokens",
      ),
      text(
        ", edit your commitnote token, under Account permissions set Gists to Read and write, and save. Classic token: open ",
      ),
      link("github.com/settings/tokens", "https://github.com/settings/tokens"),
      text(
        ", edit the token, and tick the gist scope. Then try again; you don't need to log in again.",
      ),
    ];
  }
  return [
    text("Sharing needs an access token with the api scope. Create one at "),
    link(
      "gitlab.com/-/user_settings/personal_access_tokens",
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    ),
    text(" with the api scope, then log out and log in with it."),
  ];
}

export function describeShareError(
  error: ShareError,
  providerId: ForgeId,
): readonly MessagePart[] {
  const forge = FORGE_NAMES[providerId];
  switch (error.kind) {
    case "permissionMissing":
      return permissionMissing(providerId);
    case "rateLimited": {
      const minutes = Math.max(1, Math.ceil(error.retryAfterMs / MINUTE_MS));
      const unit = minutes === 1 ? "minute" : "minutes";
      return [
        text(
          `Too many requests to ${forge} right now. Try again in ${minutes} ${unit}.`,
        ),
      ];
    }
    case "network":
      return [
        text(`Couldn't reach ${forge}. Check your connection and try again.`),
      ];
    case "server":
      return [text(`${forge} had a problem. Try again later.`)];
    case "unauthorized":
      return [
        text(`${forge} no longer accepts your access token. Log out and log in again.`),
      ];
    case "notSaved":
      return [
        text(
          "This note has unsaved changes or a conflict. Wait until it's saved, then try again.",
        ),
      ];
    case "tooLarge":
      return [text("This note is too large to share.")];
    case "tooManyImages":
      return [text("This note has too many images to share.")];
    case "shareMissing":
      return [
        text(
          `This link no longer exists on ${forge}. Revoke it to remove it from the list.`,
        ),
      ];
    case "labelTooLong":
      return [text(`Use ${MAX_SHARE_LABEL_LENGTH} characters or fewer.`)];
    case "shareGone":
      return [text("This link is no longer in your shared links.")];
    case "sharesUnavailable":
      return [
        text(
          "Shared links can't be changed because the stored list of shared links can't be read.",
        ),
      ];
  }
}

export function describeShareUpdate(
  result: UpdateShareResult,
  forgeId: ForgeId,
): { readonly tone: "success" | "info" | "error"; readonly text: string } {
  if (!result.ok) {
    return {
      tone: "error",
      text: messageText(describeShareError(result.error, forgeId)),
    };
  }
  return result.unchanged
    ? { tone: "info", text: SHARE_UNCHANGED_TEXT }
    : { tone: "success", text: SHARE_UPDATED_TEXT };
}

export function messageText(parts: readonly MessagePart[]): string {
  return parts.map((part) => part.text).join("");
}

export function describeShareDate(dates: {
  readonly sharedAt: string;
  readonly updatedAt: string | null;
}): string {
  const format = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(iso),
    );
  return dates.updatedAt === null
    ? `Shared ${format(dates.sharedAt)}`
    : `Updated ${format(dates.updatedAt)}`;
}

export function compactShareDate(iso: string, now: Date): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}
