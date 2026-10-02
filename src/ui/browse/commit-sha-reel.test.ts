import { describe, expect, it } from "vitest";
import { digitIndex, MAX_ROLL_MS, rollDurationMs } from "./commit-sha-reel";

describe("digitIndex", () => {
  it("places hex digits in rolling order, ignoring case", () => {
    expect(digitIndex("0")).toBe(0);
    expect(digitIndex("9")).toBe(9);
    expect(digitIndex("a")).toBe(10);
    expect(digitIndex("F")).toBe(15);
  });

  it("rejects characters outside hex", () => {
    expect(digitIndex("g")).toBe(-1);
  });
});

describe("rollDurationMs", () => {
  it("does not roll an unchanged character", () => {
    expect(rollDurationMs("4", "4")).toBe(0);
  });

  it("takes the longest across the whole range, never more than the cap", () => {
    expect(rollDurationMs("0", "f")).toBe(MAX_ROLL_MS);
    expect(rollDurationMs("f", "0")).toBe(MAX_ROLL_MS);
  });

  it("takes longer the more digits it passes", () => {
    expect(rollDurationMs("4", "5")).toBeLessThan(rollDurationMs("4", "b"));
    expect(rollDurationMs("4", "b")).toBeLessThan(rollDurationMs("0", "f"));
  });

  it("does not roll characters outside hex", () => {
    expect(rollDurationMs("x", "4")).toBe(0);
  });
});
