import { describe, expect, it } from "vitest";
import {
  automaticDeviceName,
  DEVICE_NAME_MAX_LENGTH,
  effectiveDeviceName,
  normalizeDeviceName,
  type PlatformInputs,
} from "./device-name";

const UA = {
  linuxFirefox:
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  linuxChrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  linuxHeadless:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};

function inputs(overrides: Partial<PlatformInputs>): PlatformInputs {
  return {
    desktopShell: false,
    standalone: false,
    userAgent: "",
    maxTouchPoints: 0,
    ...overrides,
  };
}

describe("automaticDeviceName", () => {
  it("names the desktop shell by OS", () => {
    expect(
      automaticDeviceName(
        inputs({ desktopShell: true, userAgent: UA.linuxChrome }),
      ),
    ).toBe("Desktop app on Linux");
    expect(
      automaticDeviceName(
        inputs({ desktopShell: true, userAgent: UA.windowsEdge }),
      ),
    ).toBe("Desktop app on Windows");
    expect(
      automaticDeviceName(
        inputs({ desktopShell: true, userAgent: UA.macSafari }),
      ),
    ).toBe("Desktop app on macOS");
  });

  it("prefers the desktop shell over standalone", () => {
    expect(
      automaticDeviceName(
        inputs({
          desktopShell: true,
          standalone: true,
          userAgent: UA.linuxChrome,
        }),
      ),
    ).toBe("Desktop app on Linux");
  });

  it("names an installed app by OS", () => {
    expect(
      automaticDeviceName(
        inputs({ standalone: true, userAgent: UA.androidChrome }),
      ),
    ).toBe("Android app");
    expect(
      automaticDeviceName(
        inputs({ standalone: true, userAgent: UA.iphoneSafari }),
      ),
    ).toBe("iOS app");
    expect(
      automaticDeviceName(
        inputs({
          standalone: true,
          userAgent: UA.ipadAsMac,
          maxTouchPoints: 5,
        }),
      ),
    ).toBe("iOS app");
  });

  it("names browsers on various systems", () => {
    expect(automaticDeviceName(inputs({ userAgent: UA.linuxFirefox }))).toBe(
      "Firefox on Linux",
    );
    expect(automaticDeviceName(inputs({ userAgent: UA.windowsFirefox }))).toBe(
      "Firefox on Windows",
    );
    expect(automaticDeviceName(inputs({ userAgent: UA.windowsChrome }))).toBe(
      "Chrome on Windows",
    );
    expect(automaticDeviceName(inputs({ userAgent: UA.macChrome }))).toBe(
      "Chrome on macOS",
    );
    expect(automaticDeviceName(inputs({ userAgent: UA.windowsEdge }))).toBe(
      "Edge on Windows",
    );
    expect(automaticDeviceName(inputs({ userAgent: UA.macSafari }))).toBe(
      "Safari on macOS",
    );
    expect(
      automaticDeviceName(inputs({ userAgent: UA.iphoneSafari })),
    ).toBe("Safari on iOS");
    expect(automaticDeviceName(inputs({ userAgent: UA.androidChrome }))).toBe(
      "Chrome on Android",
    );
  });

  it("treats a Macintosh UA with a touch screen as iOS", () => {
    expect(
      automaticDeviceName(
        inputs({ userAgent: UA.ipadAsMac, maxTouchPoints: 5 }),
      ),
    ).toBe("Safari on iOS");
  });

  it("names Chrome on ChromeOS", () => {
    expect(automaticDeviceName(inputs({ userAgent: UA.chromeOs }))).toBe(
      "Chrome on ChromeOS",
    );
  });

  it("names HeadlessChrome as Chrome", () => {
    expect(automaticDeviceName(inputs({ userAgent: UA.linuxHeadless }))).toBe(
      "Chrome on Linux",
    );
  });

  it("falls back for an empty or unknown UA", () => {
    expect(automaticDeviceName(inputs({ userAgent: "" }))).toBe(
      "Browser on Unknown OS",
    );
    expect(automaticDeviceName(inputs({ userAgent: "curl/8.0" }))).toBe(
      "Browser on Unknown OS",
    );
  });
});

describe("normalizeDeviceName", () => {
  it("trims", () => {
    expect(normalizeDeviceName("  Work laptop  ")).toBe("Work laptop");
  });

  it("collapses whitespace and newlines to single spaces", () => {
    expect(normalizeDeviceName("Work   laptop")).toBe("Work laptop");
    expect(normalizeDeviceName("Work\r\n\tlaptop\nhome")).toBe(
      "Work laptop home",
    );
  });

  it("removes control characters", () => {
    expect(normalizeDeviceName("Wo\u0000rk\u007F lap\u009Ftop\u001B")).toBe(
      "Work laptop",
    );
  });

  it("caps the length by code points and trims after cutting", () => {
    const long = "a".repeat(DEVICE_NAME_MAX_LENGTH + 10);
    expect(normalizeDeviceName(long)).toBe("a".repeat(DEVICE_NAME_MAX_LENGTH));
    expect(normalizeDeviceName("😀".repeat(50))).toBe(
      "😀".repeat(DEVICE_NAME_MAX_LENGTH),
    );
    const spaced = `${"a".repeat(DEVICE_NAME_MAX_LENGTH - 1)} b`;
    expect(normalizeDeviceName(spaced)).toBe(
      "a".repeat(DEVICE_NAME_MAX_LENGTH - 1),
    );
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(normalizeDeviceName("")).toBeNull();
    expect(normalizeDeviceName(" \n\t ")).toBeNull();
    expect(normalizeDeviceName("\u0000\u0007")).toBeNull();
  });
});

describe("effectiveDeviceName", () => {
  const platform = inputs({ userAgent: UA.linuxFirefox });

  it("prefers the stored name", () => {
    expect(effectiveDeviceName("My phone", platform)).toBe("My phone");
  });

  it("falls back to the automatic name", () => {
    expect(effectiveDeviceName(null, platform)).toBe("Firefox on Linux");
  });
});
