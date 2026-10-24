import { describe, expect, it } from "vitest";
import {
  appForwardingTarget,
  INSTALLED_DISPLAY_MODES,
  runsInstalled,
} from "./forwarding";

function at(pathname: string, search = "", hash = "") {
  return { pathname, search, hash };
}

function fakeMatchMedia(...matching: string[]) {
  return (query: string) => ({
    matches: matching.some((mode) => query === `(display-mode: ${mode})`),
  });
}

describe("appForwardingTarget", () => {
  it.each(["/", "/index.html"])("forwards a share hash on %s", (pathname) => {
    expect(
      appForwardingTarget(at(pathname, "?x=1", "#share=1.gh.abc.def"), false),
    ).toBe("/app/?x=1#share=1.gh.abc.def");
  });

  it("forwards a note fragment", () => {
    expect(appForwardingTarget(at("/", "", "#n=AAAA"), false)).toBe(
      "/app/#n=AAAA",
    );
  });

  it.each(["new-note", "search"])("forwards launch action %s", (action) => {
    expect(appForwardingTarget(at("/", `?action=${action}`), false)).toBe(
      `/app/?action=${action}`,
    );
  });

  it("keeps the full query and hash", () => {
    expect(
      appForwardingTarget(
        at("/", "?fake-forge-session=x&action=search", "#top"),
        false,
      ),
    ).toBe("/app/?fake-forge-session=x&action=search#top");
  });

  it("forwards when installed", () => {
    expect(appForwardingTarget(at("/"), true)).toBe("/app/");
  });

  it.each([
    ["/app/", "", ""],
    ["/app/x", "", ""],
    ["/app/", "", "#share=1.gh.abc.def"],
    ["/app/", "?action=search", ""],
    ["/app/x", "", "#n=AAAA"],
  ])("never forwards under the app path: %s%s%s", (pathname, search, hash) => {
    expect(appForwardingTarget(at(pathname, search, hash), true)).toBeNull();
  });

  it.each([
    ["", ""],
    ["", "#how-it-works"],
    ["", "#main"],
    ["", "#features"],
    ["?fake-forge-session=x", ""],
    ["?action=", ""],
    ["?action=delete", ""],
    ["?action=New-Note", ""],
    ["", "#action=search"],
    ["", "#note=abc"],
    ["", "#sharex"],
  ])("does not forward %j %j", (search, hash) => {
    expect(appForwardingTarget(at("/", search, hash), false)).toBeNull();
  });
});

describe("runsInstalled", () => {
  it.each(INSTALLED_DISPLAY_MODES)("is true for %s", (mode) => {
    expect(runsInstalled(fakeMatchMedia(mode))).toBe(true);
    expect(appForwardingTarget(at("/"), runsInstalled(fakeMatchMedia(mode)))).toBe(
      "/app/",
    );
  });

  it("is false for fullscreen alone", () => {
    const installed = runsInstalled(fakeMatchMedia("fullscreen"));
    expect(installed).toBe(false);
    expect(appForwardingTarget(at("/"), installed)).toBeNull();
  });

  it("is false for a plain browser tab", () => {
    expect(runsInstalled(fakeMatchMedia("browser"))).toBe(false);
  });
});
