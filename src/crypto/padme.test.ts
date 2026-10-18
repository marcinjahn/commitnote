import { describe, expect, it } from "vitest";
import { padmeLength } from "./padme";

describe("padmeLength", () => {
  it("matches known values", () => {
    expect(padmeLength(1000)).toBe(1024);
    expect(padmeLength(100000)).toBe(100352);
    expect(padmeLength(1024)).toBe(1024);
  });

  it("leaves lengths below two unchanged", () => {
    expect(padmeLength(0)).toBe(0);
    expect(padmeLength(1)).toBe(1);
  });

  it("is correct above 2^31", () => {
    expect(padmeLength(2 ** 31)).toBe(2 ** 31);
    expect(padmeLength(2 ** 31 + 1)).toBe(2 ** 31 + 2 ** 26);
  });

  it("never shrinks, is monotonic and stays within 12% overhead", () => {
    let previous = 0;
    for (let length = 2; length <= 4096; length += 1) {
      const padded = padmeLength(length);
      expect(padded).toBeGreaterThanOrEqual(length);
      expect(padded).toBeGreaterThanOrEqual(previous);
      previous = padded;
    }
    previous = 0;
    for (let length = 256; length <= 2 ** 24; length = Math.ceil(length * 1.013) + 1) {
      const padded = padmeLength(length);
      expect(padded).toBeGreaterThanOrEqual(length);
      expect(padded).toBeGreaterThanOrEqual(previous);
      expect((padded - length) / length).toBeLessThanOrEqual(0.12);
      previous = padded;
    }
  });
});
