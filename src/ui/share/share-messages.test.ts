import { describe, expect, it } from "vitest";
import type { ShareError } from "../../share/share-service";
import {
  describeShareError,
  describeSharedAt,
  messageText,
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
    "sharesUnavailable",
    "Shared links can't be changed because the stored list of shared links can't be read.",
    "Shared links can't be changed because the stored list of shared links can't be read.",
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

describe("describeSharedAt", () => {
  it("prefixes a medium date", () => {
    const iso = "2026-03-04T12:00:00.000Z";
    expect(describeSharedAt(iso)).toBe(
      `Shared ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso))}`,
    );
  });
});
