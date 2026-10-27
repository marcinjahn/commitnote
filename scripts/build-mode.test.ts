import { describe, expect, it } from "vitest";
import {
  buildModeFacts,
  FAKE_ANALYTICS_ENDPOINT,
  goatCounterEndpoint,
} from "./build-mode";

describe("buildModeFacts", () => {
  it.each([
    ["production", false, false, null],
    ["fake-forge", false, true, FAKE_ANALYTICS_ENDPOINT],
    ["desktop", true, false, null],
    ["desktop-fake", true, true, FAKE_ANALYTICS_ENDPOINT],
    ["native-core", false, false, null],
    ["native-core-fake", false, true, null],
    ["development", false, false, null],
    ["test", false, false, null],
    ["something-else", false, false, null],
  ])("maps %s", (mode, desktopShell, fakeForge, analyticsEndpoint) => {
    expect(buildModeFacts(mode, null)).toEqual({
      desktopShell,
      fakeForge,
      analyticsEndpoint,
    });
  });

  it.each([
    ["production", "https://commitnote.goatcounter.com/count"],
    ["desktop", "https://commitnote.goatcounter.com/count"],
    ["fake-forge", FAKE_ANALYTICS_ENDPOINT],
    ["desktop-fake", FAKE_ANALYTICS_ENDPOINT],
    ["development", null],
  ])("maps %s with a site code", (mode, analyticsEndpoint) => {
    expect(buildModeFacts(mode, "commitnote").analyticsEndpoint).toBe(
      analyticsEndpoint,
    );
  });

  it("rejects an invalid site code in every mode", () => {
    expect(() => buildModeFacts("development", "Bad Code")).toThrow(
      /Bad Code/,
    );
  });
});

describe("goatCounterEndpoint", () => {
  it("returns null without a site code", () => {
    expect(goatCounterEndpoint(null)).toBeNull();
  });

  it("builds the count endpoint from a valid site code", () => {
    expect(goatCounterEndpoint("my-site-1")).toBe(
      "https://my-site-1.goatcounter.com/count",
    );
  });

  it.each(["", "Commit", "a.b", "x/y", "a b"])(
    "rejects %j",
    (siteCode) => {
      expect(() => goatCounterEndpoint(siteCode)).toThrow(
        /lowercase letters, digits and hyphens/,
      );
    },
  );
});
