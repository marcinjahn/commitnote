import { describe, expect, it } from "vitest";
import { readFakeForgeOptions } from "./fake-forge-options";
import { GITHUB_LIKE_LATENCY, NO_LATENCY } from "./forge-latency";

describe("readFakeForgeOptions", () => {
  it("missing options means GitHub-like latency", () => {
    expect(readFakeForgeOptions(undefined).latency).toBe(GITHUB_LIKE_LATENCY);
  });

  it("null options mean GitHub-like latency", () => {
    expect(readFakeForgeOptions(null).latency).toBe(GITHUB_LIKE_LATENCY);
  });

  it.each(["none", 42, true])(
    "a non-object value %s means GitHub-like latency",
    (source) => {
      expect(readFakeForgeOptions(source).latency).toBe(GITHUB_LIKE_LATENCY);
    },
  );

  it("an object without latency means GitHub-like latency", () => {
    expect(readFakeForgeOptions({}).latency).toBe(GITHUB_LIKE_LATENCY);
  });

  it('latency "github" means GitHub-like latency', () => {
    expect(readFakeForgeOptions({ latency: "github" }).latency).toBe(
      GITHUB_LIKE_LATENCY,
    );
  });

  it.each(["fast", "", 0, null])(
    "an unknown latency value %s means GitHub-like latency",
    (latency) => {
      expect(readFakeForgeOptions({ latency }).latency).toBe(
        GITHUB_LIKE_LATENCY,
      );
    },
  );

  it('latency "none" turns every simulated delay off', () => {
    expect(readFakeForgeOptions({ latency: "none" }).latency).toBe(NO_LATENCY);
    expect(Object.values(NO_LATENCY).every((ms) => ms === 0)).toBe(true);
  });
});
