import { describe, expect, it } from "vitest";
import {
  shouldShowShareInvite,
  type ShareInviteConditions,
} from "./share-invite-visibility";

const none: ShareInviteConditions = {
  standalone: false,
  hasLastLoginHint: false,
  dismissed: false,
};

describe("shouldShowShareInvite", () => {
  it("shows when no condition hides it", () => {
    expect(shouldShowShareInvite(none)).toBe(true);
  });

  it.each([
    ["standalone", { ...none, standalone: true }],
    ["hasLastLoginHint", { ...none, hasLastLoginHint: true }],
    ["dismissed", { ...none, dismissed: true }],
  ] as const)("hides when %s is true", (_name, conditions) => {
    expect(shouldShowShareInvite(conditions)).toBe(false);
  });
});
