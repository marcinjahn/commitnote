import { describe, expect, it } from "vitest";

import { formatHex, mixOklab, parseHex } from "./color-mix";

describe("color mix", () => {
  it.each([
    ["#0a0a0a", "#cc4e00"],
    ["#ededed", "#ffa057"],
  ])("returns the endpoints at fractions 0 and 1 for %s -> %s", (from, to) => {
    expect(mixOklab(from, to, 0)).toBe(from);
    expect(mixOklab(from, to, 1)).toBe(to);
  });

  it("mixes black and white at the OKLab lightness midpoint", () => {
    expect(mixOklab("#000000", "#ffffff", 0.5)).toBe("#636363");
  });

  it.each(["#0a0a0a", "#CC4E00", "#FfA057", "#000000", "#ffffff"])(
    "round-trips %s through parse and format",
    (hex) => {
      expect(formatHex(parseHex(hex))).toBe(hex.toLowerCase());
    },
  );

  it("clamps and rounds channels when formatting", () => {
    expect(formatHex({ r: -5, g: 127.6, b: 300 })).toBe("#0080ff");
  });

  it.each(["#fff", "red", "0a0a0a"])("rejects %s as a hex color", (input) => {
    expect(() => parseHex(input)).toThrow(input);
  });

  it.each([-0.1, 1.1])("rejects mix fraction %s", (fraction) => {
    expect(() => mixOklab("#000000", "#ffffff", fraction)).toThrow();
  });
});
