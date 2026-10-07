import { describe, expect, it } from "vitest";
import { caretTailStops } from "./caret-style";

describe("caretTailStops", () => {
  it("spreads the accent evenly from none to full across the tail", () => {
    expect(caretTailStops(3)).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it("gives a single letter the whole ramp", () => {
    expect(caretTailStops(1)).toEqual([0, 1]);
  });
});
