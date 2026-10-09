import { describe, expect, it } from "vitest";
import {
  installOffer,
  isIosDevice,
  type InstallFacts,
  type InstallOffer,
} from "./install-offer";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPOD =
  "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

describe("isIosDevice", () => {
  it.each([
    ["iPhone Safari", IPHONE, 5, true],
    ["iPad", IPAD, 5, true],
    ["iPod", IPOD, 5, true],
    ["iPadOS desktop-class", MAC, 5, true],
    ["macOS Safari without touch", MAC, 0, false],
    ["macOS Safari with a single touch point", MAC, 1, false],
    ["Android Chrome", PIXEL, 5, false],
    ["desktop Chrome on Windows", WINDOWS_CHROME, 0, false],
  ])("%s", (_name, userAgent, maxTouchPoints, expected) => {
    expect(isIosDevice({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

const FACT_KEYS = [
  "coarsePointer",
  "browserDisplayMode",
  "standalone",
  "ios",
  "deferredPrompt",
  "dismissed",
  "installed",
] as const satisfies readonly (keyof InstallFacts)[];

function allFacts(): InstallFacts[] {
  return Array.from({ length: 2 ** FACT_KEYS.length }, (_, mask) => {
    const facts = {} as InstallFacts;
    FACT_KEYS.forEach((key, bit) => {
      facts[key] = (mask & (1 << bit)) !== 0;
    });
    return facts;
  });
}

function oracle(f: InstallFacts): InstallOffer {
  const hasPath = f.deferredPrompt || f.ios;
  const prompt = f.deferredPrompt;
  const notInstalled = !f.standalone && !f.installed;
  const showBar =
    f.coarsePointer && f.browserDisplayMode && notInstalled && !f.dismissed;

  const pick = (): "prompt" | "ios" => (prompt ? "prompt" : "ios");
  return {
    bar: hasPath && showBar ? pick() : "none",
    command: hasPath && notInstalled ? pick() : null,
  };
}

const base: InstallFacts = {
  coarsePointer: false,
  browserDisplayMode: false,
  standalone: false,
  ios: false,
  deferredPrompt: false,
  dismissed: false,
  installed: false,
};

describe("installOffer", () => {
  const combinations = allFacts();

  it("covers every combination of the seven facts", () => {
    expect(combinations).toHaveLength(128);
    expect(new Set(combinations.map((f) => JSON.stringify(f))).size).toBe(128);
  });

  it.each(combinations.map((facts) => [JSON.stringify(facts), facts] as const))(
    "%s",
    (_name, facts) => {
      expect(installOffer(facts)).toEqual(oracle(facts));
    },
  );

  it("offers the browser install prompt on Android Chrome in browser mode", () => {
    expect(
      installOffer({
        ...base,
        coarsePointer: true,
        browserDisplayMode: true,
        deferredPrompt: true,
      }),
    ).toEqual({ bar: "prompt", command: "prompt" });
  });

  it("offers iOS instructions on iPhone Safari", () => {
    expect(
      installOffer({
        ...base,
        coarsePointer: true,
        browserDisplayMode: true,
        ios: true,
      }),
    ).toEqual({ bar: "ios", command: "ios" });
  });

  it("keeps only the command on desktop Chrome with a deferred prompt", () => {
    expect(
      installOffer({ ...base, browserDisplayMode: true, deferredPrompt: true }),
    ).toEqual({ bar: "none", command: "prompt" });
  });

  it("keeps the command after the install bar is dismissed", () => {
    expect(
      installOffer({
        ...base,
        coarsePointer: true,
        browserDisplayMode: true,
        deferredPrompt: true,
        dismissed: true,
      }),
    ).toEqual({ bar: "none", command: "prompt" });
  });

  it("offers nothing when standalone", () => {
    expect(
      installOffer({
        ...base,
        coarsePointer: true,
        standalone: true,
        deferredPrompt: true,
        ios: true,
      }),
    ).toEqual({ bar: "none", command: null });
  });

  it("offers nothing after the app is installed", () => {
    expect(
      installOffer({
        ...base,
        coarsePointer: true,
        browserDisplayMode: true,
        deferredPrompt: true,
        installed: true,
      }),
    ).toEqual({ bar: "none", command: null });
  });

  it("offers nothing without an install path", () => {
    expect(
      installOffer({ ...base, coarsePointer: true, browserDisplayMode: true }),
    ).toEqual({ bar: "none", command: null });
  });

  it("prefers the deferred install prompt over iOS", () => {
    expect(
      installOffer({
        ...base,
        coarsePointer: true,
        browserDisplayMode: true,
        deferredPrompt: true,
        ios: true,
      }),
    ).toEqual({ bar: "prompt", command: "prompt" });
  });
});
