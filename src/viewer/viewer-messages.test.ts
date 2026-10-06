import { describe, expect, it } from "vitest";
import { describeViewerError } from "./viewer-messages";

describe("describeViewerError", () => {
  it("describes link problems without a provider", () => {
    const expected = "This link is incomplete or damaged. Ask for the link again.";
    expect(describeViewerError("invalid", null)).toBe(expected);
    expect(describeViewerError("damaged", "github")).toBe(expected);
  });

  it("describes a missing share and unsupported browsers", () => {
    expect(describeViewerError("notFound", "gitlab")).toBe(
      "This shared note is no longer available. It was removed by its owner, or the link is wrong.",
    );
    expect(describeViewerError("unsupported", null)).toBe(
      "This browser can't open encrypted notes.",
    );
  });

  it.each([
    ["github", "GitHub"],
    ["gitlab", "GitLab"],
  ] as const)("names the %s host in transient errors", (provider, name) => {
    expect(describeViewerError("rateLimited", provider)).toBe(
      `${name} is limiting requests from your network. Try again in a few minutes.`,
    );
    expect(describeViewerError("network", provider)).toBe(
      `Couldn't reach ${name}. Check your connection.`,
    );
    expect(describeViewerError("server", provider)).toBe(
      `${name} isn't responding right now. Try again in a moment.`,
    );
  });
});
