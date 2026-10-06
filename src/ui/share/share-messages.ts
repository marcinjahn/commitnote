import type { ForgeId } from "../../forge/repo-coordinates";
import type { ShareError } from "../../share/share-service";

export type MessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

const MINUTE_MS = 60_000;

const FORGE_NAMES: Readonly<Record<ForgeId, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
};

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
    case "sharesUnavailable":
      return [
        text(
          "Shared links can't be changed because the stored list of shared links can't be read.",
        ),
      ];
  }
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
