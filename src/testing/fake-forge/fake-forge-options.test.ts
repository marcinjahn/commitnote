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

describe("readFakeForgeOptions argon2Results", () => {
  it.each([undefined, null, "none", {}, { latency: "none" }])(
    "is null when the source %j has no argon2Results",
    (source) => {
      expect(readFakeForgeOptions(source).argon2Results).toBeNull();
    },
  );

  it.each(["key:hash", { key: "hash" }, 1, null])(
    "is null when argon2Results %j is not an array",
    (argon2Results) => {
      expect(readFakeForgeOptions({ argon2Results }).argon2Results).toBeNull();
    },
  );

  it("an empty array means memoize with no seed", () => {
    expect(readFakeForgeOptions({ argon2Results: [] }).argon2Results).toEqual(
      [],
    );
  });

  it("keeps well-formed entries in order", () => {
    const argon2Results = [
      ["a", "AAAA"],
      ["b", "BBBB"],
    ];
    expect(readFakeForgeOptions({ argon2Results }).argon2Results).toEqual(
      argon2Results,
    );
  });

  it("skips malformed entries", () => {
    const argon2Results = [
      ["a", "AAAA"],
      ["only key"],
      ["b", "BBBB", "extra"],
      ["c", 3],
      [4, "DDDD"],
      "e:EEEE",
      null,
      ["f", "FFFF"],
    ];
    expect(readFakeForgeOptions({ argon2Results }).argon2Results).toEqual([
      ["a", "AAAA"],
      ["f", "FFFF"],
    ]);
  });

  it("does not change how latency is read", () => {
    expect(
      readFakeForgeOptions({ latency: "none", argon2Results: [] }).latency,
    ).toBe(NO_LATENCY);
  });
});
