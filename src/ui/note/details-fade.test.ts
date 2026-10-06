import { describe, expect, it } from "vitest";
import { cubicBezier } from "./details-fade";

describe("cubicBezier", () => {
  it("is the identity for a linear curve", () => {
    const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    for (const x of [0, 0.1, 0.5, 0.9, 1]) {
      expect(linear(x)).toBeCloseTo(x, 5);
    }
  });

  it("starts at 0, ends at 1 and rises monotonically", () => {
    const ease = cubicBezier(0.2, 0, 0, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const value = ease(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("matches the CSS curve's decelerating shape", () => {
    const ease = cubicBezier(0.2, 0, 0, 1);
    expect(ease(0.5)).toBeGreaterThan(0.85);
  });
});
