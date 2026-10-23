import { describe, expect, it } from "vitest";
import type { ShareError, UpdateShareResult } from "../../share/share-service";
import {
  describeShareDate,
  describeShareError,
  describeShareUpdate,
  shareActionsLabel,
  shareDialogTitle,
  shareExplanation,
  messageText,
  SHARE_UNCHANGED_TEXT,
  SHARE_UPDATED_TEXT,
  compactShareDate,
} from "./share-messages";

const SIMPLE: readonly [ShareError["kind"], string, string][] = [
  [
    "network",
    "Couldn't reach GitHub. Check your connection and try again.",
    "Couldn't reach GitLab. Check your connection and try again.",
  ],
  [
    "server",
    "GitHub had a problem. Try again later.",
    "GitLab had a problem. Try again later.",
  ],
  [
    "unauthorized",
    "GitHub no longer accepts your access token. Log out and log in again.",
    "GitLab no longer accepts your access token. Log out and log in again.",
  ],
  [
    "notSaved",
    "This note has unsaved changes or a conflict. Wait until it's saved, then try again.",
    "This note has unsaved changes or a conflict. Wait until it's saved, then try again.",
  ],
  [
    "tooLarge",
    "This note is too large to share.",
    "This note is too large to share.",
  ],
  [
    "tooManyImages",
    "This note has too many images to share.",
    "This note has too many images to share.",
  ],
  [
    "shareMissing",
    "This link no longer exists on GitHub. Revoke it to remove it from the list.",
    "This link no longer exists on GitLab. Revoke it to remove it from the list.",
  ],
  [
    "sharesUnavailable",
    "Shared links can't be changed because the stored list of shared links can't be read.",
    "Shared links can't be changed because the stored list of shared links can't be read.",
  ],
  [
    "labelTooLong",
    "Use 100 characters or fewer.",
    "Use 100 characters or fewer.",
  ],
  [
    "shareGone",
    "This link is no longer in your shared links.",
    "This link is no longer in your shared links.",
  ],
];

describe("describeShareError", () => {
  it.each(SIMPLE)("describes %s for both forges", (kind, github, gitlab) => {
    const error = { kind } as ShareError;
    expect(describeShareError(error, "github")).toEqual([
      { kind: "text", text: github },
    ]);
    expect(describeShareError(error, "gitlab")).toEqual([
      { kind: "text", text: gitlab },
    ]);
  });

  it("explains the missing GitHub permission with links", () => {
    const parts = describeShareError({ kind: "permissionMissing" }, "github");
    expect(parts.filter((part) => part.kind === "link")).toEqual([
      {
        kind: "link",
        text: "github.com/settings/personal-access-tokens",
        href: "https://github.com/settings/personal-access-tokens",
      },
      {
        kind: "link",
        text: "github.com/settings/tokens",
        href: "https://github.com/settings/tokens",
      },
    ]);
    expect(messageText(parts)).toBe(
      "Sharing needs permission to create gists, and your access token doesn't have it. Fine-grained token: open github.com/settings/personal-access-tokens, edit your commitnote token, under Account permissions set Gists to Read and write, and save. Classic token: open github.com/settings/tokens, edit the token, and tick the gist scope. Then try again; you don't need to log in again.",
    );
  });

  it("explains the missing GitLab scope with a link", () => {
    const parts = describeShareError({ kind: "permissionMissing" }, "gitlab");
    expect(parts).toEqual([
      {
        kind: "text",
        text: "Sharing needs an access token with the api scope. Create one at ",
      },
      {
        kind: "link",
        text: "gitlab.com/-/user_settings/personal_access_tokens",
        href: "https://gitlab.com/-/user_settings/personal_access_tokens",
      },
      { kind: "text", text: " with the api scope, then log out and log in with it." },
    ]);
  });

  it.each([
    [0, "1 minute"],
    [1, "1 minute"],
    [60_000, "1 minute"],
    [60_001, "2 minutes"],
    [300_000, "5 minutes"],
  ])("rounds a %s ms wait up to %s", (retryAfterMs, wait) => {
    const parts = describeShareError(
      { kind: "rateLimited", retryAfterMs },
      "gitlab",
    );
    expect(messageText(parts)).toBe(
      `Too many requests to GitLab right now. Try again in ${wait}.`,
    );
  });
});

describe("update texts", () => {
  it("has the toast texts", () => {
    expect(SHARE_UPDATED_TEXT).toBe("Link updated");
    expect(SHARE_UNCHANGED_TEXT).toBe("Link already shows the current version");
  });
});

describe("messageText", () => {
  it("concatenates text and link parts", () => {
    expect(
      messageText([
        { kind: "text", text: "Open " },
        { kind: "link", text: "example.com", href: "https://example.com" },
        { kind: "text", text: "." },
      ]),
    ).toBe("Open example.com.");
  });
});

describe("describeShareDate", () => {
  const format = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));

  it("shows the share date when the share was never updated", () => {
    const sharedAt = "2026-03-04T12:00:00.000Z";
    expect(describeShareDate({ sharedAt, updatedAt: null })).toBe(`Shared ${format(sharedAt)}`);
  });

  it("shows the update date when the share was updated", () => {
    const sharedAt = "2026-03-04T12:00:00.000Z";
    const updatedAt = "2026-05-06T12:00:00.000Z";
    expect(describeShareDate({ sharedAt, updatedAt })).toBe(`Updated ${format(updatedAt)}`);
  });
});

describe("compactShareDate", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("omits the year for dates in the current year", () => {
    const iso = "2026-03-04T12:00:00.000Z";
    const expected = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
      new Date(iso),
    );
    expect(compactShareDate(iso, now)).toBe(expected);
  });

  it("includes the year for dates in another year", () => {
    const iso = "2025-12-20T12:00:00.000Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
    expect(compactShareDate(iso, now)).toBe(expected);
    expect(compactShareDate(iso, now)).toContain("2025");
  });
});

describe("describeShareUpdate", () => {
  const entry = {} as never;

  it("reports an updated link as success", () => {
    const result: UpdateShareResult = { ok: true, entry, unchanged: false };
    expect(describeShareUpdate(result, "github")).toEqual({
      tone: "success",
      text: SHARE_UPDATED_TEXT,
    });
  });

  it("reports an unchanged link as info", () => {
    const result: UpdateShareResult = { ok: true, entry, unchanged: true };
    expect(describeShareUpdate(result, "github")).toEqual({
      tone: "info",
      text: SHARE_UNCHANGED_TEXT,
    });
  });

  it("reports a failure as an error with the forge-specific text", () => {
    const result: UpdateShareResult = { ok: false, error: { kind: "server" } };
    expect(describeShareUpdate(result, "gitlab")).toEqual({
      tone: "error",
      text: "GitLab had a problem. Try again later.",
    });
  });
});

describe("share dialog copy", () => {
  it("titles the dialog with the note name", () => {
    expect(shareDialogTitle("Ideas")).toBe("Share “Ideas”");
  });

  it("explains sharing per forge", () => {
    expect(shareExplanation("github")).toContain("secret gist on your GitHub account");
    expect(shareExplanation("gitlab")).toContain("public snippet on your GitLab account");
  });

  it("labels the row actions", () => {
    expect(shareActionsLabel("For Anna")).toBe("Share actions for For Anna");
  });
});
