import { describe, expect, it } from "vitest";
import {
  compareKeys,
  isValidKey,
  keyBetween,
  keysBetween,
} from "./fractional-key";

function expectAscending(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) {
    expect(compareKeys(keys[i - 1], keys[i])).toBe(-1);
  }
}

describe("keyBetween", () => {
  it("returns a valid key between any two bounds", () => {
    const cases: [string | null, string | null][] = [
      [null, null],
      [null, "1"],
      [null, "01"],
      ["z", null],
      ["zzz", null],
      ["V", "W"],
      ["V", "V1"],
      ["A01", "A02"],
      ["A0z", "A1"],
    ];
    for (const [before, after] of cases) {
      const key = keyBetween(before, after);
      expect(isValidKey(key)).toBe(true);
      if (before !== null) expect(compareKeys(before, key)).toBe(-1);
      if (after !== null) expect(compareKeys(key, after)).toBe(-1);
    }
  });

  it("keeps finding room when inserting repeatedly at the same spot", () => {
    let low: string | null = null;
    let high: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 200; i++) {
      const key = keyBetween(low, high);
      keys.push(key);
      if (i % 2 === 0) low = key;
      else high = key;
    }
    for (const key of keys) expect(isValidKey(key)).toBe(true);
    expectAscending(
      [...keys].sort((a, b) => compareKeys(a, b)),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rejects bounds that are invalid or not ascending", () => {
    expect(() => keyBetween("V", "V")).toThrow(RangeError);
    expect(() => keyBetween("W", "V")).toThrow(RangeError);
    expect(() => keyBetween("V0", null)).toThrow(RangeError);
    expect(() => keyBetween(null, "")).toThrow(RangeError);
    expect(() => keyBetween("a-b", null)).toThrow(RangeError);
  });
});

describe("keysBetween", () => {
  it("returns the requested number of short ascending keys within the bounds", () => {
    const keys = keysBetween("A", "B", 100);

    expect(keys).toHaveLength(100);
    expectAscending(["A", ...keys, "B"]);
    for (const key of keys) {
      expect(isValidKey(key)).toBe(true);
      expect(key.length).toBeLessThanOrEqual(4);
    }
  });

  it("returns no keys for a count of zero", () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
  });
});
