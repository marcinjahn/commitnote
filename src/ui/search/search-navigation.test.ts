import { describe, expect, it } from "vitest";
import { keepActive, moveActive } from "./search-navigation";

describe("moveActive", () => {
  it.each([
    { index: 0, count: 3, delta: 1 as const, expected: 1 },
    { index: 2, count: 3, delta: 1 as const, expected: 0 },
    { index: 1, count: 3, delta: -1 as const, expected: 0 },
    { index: 0, count: 3, delta: -1 as const, expected: 2 },
    { index: -1, count: 3, delta: 1 as const, expected: 0 },
    { index: -1, count: 3, delta: -1 as const, expected: 2 },
    { index: 0, count: 1, delta: 1 as const, expected: 0 },
    { index: 0, count: 1, delta: -1 as const, expected: 0 },
    { index: -1, count: 0, delta: 1 as const, expected: -1 },
    { index: 0, count: 0, delta: -1 as const, expected: -1 },
  ])("moves $index of $count by $delta to $expected", ({ index, count, delta, expected }) => {
    expect(moveActive(index, count, delta)).toBe(expected);
  });
});

describe("keepActive", () => {
  it("keeps the previously active key when still present", () => {
    expect(keepActive("b", ["a", "x", "b"])).toBe(2);
  });

  it("resets to the first row when the key is gone or absent", () => {
    expect(keepActive("gone", ["a", "b"])).toBe(0);
    expect(keepActive(null, ["a", "b"])).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(keepActive("a", [])).toBe(-1);
    expect(keepActive(null, [])).toBe(-1);
  });
});
