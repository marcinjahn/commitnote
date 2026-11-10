import { afterEach, describe, expect, it, vi } from "vitest";
import { openExternal } from "./external-open";

afterEach(() => {
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
});
