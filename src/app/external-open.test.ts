import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openExternal,
  resetExternalOpener,
  setExternalOpener,
} from "./external-open";

afterEach(() => {
  resetExternalOpener();
  vi.unstubAllGlobals();
});

describe("openExternal", () => {
  it("opens a new window without opener or referrer by default", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openExternal("https://example.com/");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("uses the opener set by setExternalOpener", () => {
    const open = vi.fn();
    const windowOpen = vi.fn();
    vi.stubGlobal("window", { open: windowOpen });
    setExternalOpener(open);
    openExternal("https://example.com/");
    expect(open).toHaveBeenCalledWith("https://example.com/");
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
