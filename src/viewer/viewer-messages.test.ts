import { describe, expect, it } from "vitest";
import { describeViewerError, footerText } from "./viewer-messages";

describe("describeViewerError", () => {
  it("describes link problems without a provider", () => {
    const expected = "This link is incomplete or damaged. Ask for the link again.";
    expect(describeViewerError("invalid", null, false)).toBe(expected);
    expect(describeViewerError("damaged", "github", false)).toBe(expected);
  });

  it("describes a missing share and unsupported browsers", () => {
    expect(describeViewerError("notFound", "gitlab", false)).toBe(
      "This shared note is no longer available. It was removed by its owner, or the link is wrong.",
    );
    expect(describeViewerError("unsupported", null, false)).toBe(
      "This browser can't open encrypted notes.",
    );
  });

  it("describes an unsupported installed app as a device", () => {
    expect(describeViewerError("unsupported", null, true)).toBe(
      "This device can't open encrypted notes.",
    );
  });

  it("keeps non-browser errors the same in both modes", () => {
    expect(describeViewerError("network", "github", true)).toBe(
      describeViewerError("network", "github", false),
    );
  });

  it.each([
    ["github", "GitHub"],
    ["gitlab", "GitLab"],
  ] as const)("names the %s host in transient errors", (provider, name) => {
    expect(describeViewerError("rateLimited", provider, false)).toBe(
      `${name} is limiting requests from your network. Try again in a few minutes.`,
    );
    expect(describeViewerError("network", provider, false)).toBe(
      `Couldn't reach ${name}. Check your connection.`,
    );
    expect(describeViewerError("server", provider, false)).toBe(
      `${name} isn't responding right now. Try again in a moment.`,
    );
  });
});

describe("footerText", () => {
  it("keeps the browser footer", () => {
    expect(footerText(false)).toBe("End-to-end encrypted. Decrypted in your browser.");
  });

  it("describes decryption on the device in the installed app", () => {
    expect(footerText(true)).toBe("End-to-end encrypted. Decrypted on this device.");
  });
});
