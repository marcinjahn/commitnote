import { describe, expect, it } from "vitest";
import { buildModeFacts } from "./build-mode";

describe("buildModeFacts", () => {
  it.each([
    ["production", false],
    ["fake-forge", true],
    ["native-core", false],
    ["native-core-fake", true],
    ["development", false],
    ["test", false],
    ["something-else", false],
  ])("maps %s", (mode, fakeForge) => {
    expect(buildModeFacts(mode)).toEqual({ fakeForge });
  });
});
