import { describe, expect, it } from "vitest";
import { buildModeFacts } from "./build-mode";

describe("buildModeFacts", () => {
  it.each([
    ["production", false, false],
    ["fake-forge", false, true],
    ["desktop", true, false],
    ["desktop-fake", true, true],
    ["development", false, false],
    ["test", false, false],
    ["something-else", false, false],
  ])("maps %s", (mode, desktopShell, fakeForge) => {
    expect(buildModeFacts(mode)).toEqual({ desktopShell, fakeForge });
  });
});
