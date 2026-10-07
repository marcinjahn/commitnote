import { describe, expect, it } from "vitest";
import {
  applyPlatform,
  detectPlatform,
  isPlatform,
  PLATFORMS,
  type Platform,
  type PlatformNavigator,
} from "./platform";

const UA = {
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  linuxFirefox:
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it.each<[string, PlatformNavigator, Platform]>([
    ["Client Hints macOS", { userAgentData: { platform: "macOS" } }, "mac"],
    [
      "Client Hints Windows",
      { userAgentData: { platform: "Windows" } },
      "windows",
    ],
    [
      "Client Hints Android",
      { userAgentData: { platform: "Android" } },
      "android",
    ],
    ["Client Hints Linux", { userAgentData: { platform: "Linux" } }, "linux"],
    ["Client Hints iOS", { userAgentData: { platform: "iOS" } }, "ios"],
    [
      "Client Hints Chrome OS",
      { userAgentData: { platform: "Chrome OS" } },
      "other",
    ],
    [
      "Client Hints ChromeOS",
      { userAgentData: { platform: "ChromeOS" } },
      "other",
    ],
    [
      "Client Hints are case-insensitive",
      { userAgentData: { platform: "WINDOWS" } },
      "windows",
    ],
    [
      "Client Hints win over a conflicting UA",
      { userAgentData: { platform: "Windows" }, userAgent: UA.macSafari },
      "windows",
    ],
    ["macOS Safari UA", { userAgent: UA.macSafari }, "mac"],
    ["Windows Firefox UA", { userAgent: UA.windowsFirefox }, "windows"],
    ["Linux Firefox UA", { userAgent: UA.linuxFirefox }, "linux"],
    ["Android Chrome UA", { userAgent: UA.androidChrome }, "android"],
    ["iPhone Safari UA", { userAgent: UA.iphoneSafari }, "ios"],
    ["iPad Safari UA", { userAgent: UA.ipadSafari }, "ios"],
    [
      "iPadOS desktop-mode Safari",
      { userAgent: UA.macSafari, maxTouchPoints: 5 },
      "ios",
    ],
    [
      "Mac without touch stays mac",
      { userAgent: UA.macSafari, maxTouchPoints: 0 },
      "mac",
    ],
    [
      "Client Hints macOS with touch points",
      { userAgentData: { platform: "macOS" }, maxTouchPoints: 5 },
      "ios",
    ],
    ["ChromeOS UA", { userAgent: UA.chromeOs }, "other"],
    ["navigator.platform fallback", { platform: "MacIntel" }, "mac"],
    ["navigator.platform Win32", { platform: "Win32" }, "windows"],
    ["empty navigator", {}, "other"],
    ["unknown UA", { userAgent: "SomethingElse/1.0" }, "other"],
    [
      "empty Client Hints platform falls through to UA",
      { userAgentData: { platform: "" }, userAgent: UA.linuxFirefox },
      "linux",
    ],
    [
      "unrecognised Client Hints platform falls through to UA",
      { userAgentData: { platform: "Plan9" }, userAgent: UA.windowsFirefox },
      "windows",
    ],
    [
      "undefined userAgentData falls through to UA",
      { userAgentData: undefined, userAgent: UA.androidChrome },
      "android",
    ],
  ])("%s", (_name, nav, expected) => {
    expect(detectPlatform(nav)).toBe(expected);
  });
});

describe("isPlatform", () => {
  it.each(PLATFORMS)("accepts %s", (value) => {
    expect(isPlatform(value)).toBe(true);
  });

  it.each(["macos", "", "Mac", undefined, null, 1])("rejects %j", (value) => {
    expect(isPlatform(value)).toBe(false);
  });

  it("lists the six platforms", () => {
    expect([...PLATFORMS].sort()).toEqual(
      ["android", "ios", "linux", "mac", "other", "windows"].sort(),
    );
  });
});

describe("applyPlatform", () => {
  it("sets dataset.platform on the root", () => {
    const root: { dataset: Record<string, string | undefined> } = {
      dataset: {},
    };
    applyPlatform(root, "ios");
    expect(root.dataset.platform).toBe("ios");
  });
});
