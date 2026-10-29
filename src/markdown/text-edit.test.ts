import { describe, expect, it } from "vitest";
import { applyTextEdit } from "./text-edit";

const selection = { anchor: 0, head: 0 };

describe("applyTextEdit", () => {
  it("applies several changes expressed in the original offsets", () => {
    expect(
      applyTextEdit("one two three", {
        changes: [
          { from: 0, to: 3, insert: "1" },
          { from: 4, to: 7, insert: "2" },
          { from: 8, to: 13, insert: "3" },
        ],
        selection,
      }),
    ).toBe("1 2 3");
  });

  it("applies an insertion", () => {
    expect(
      applyTextEdit("ac", {
        changes: [{ from: 1, to: 1, insert: "b" }],
        selection,
      }),
    ).toBe("abc");
  });

  it("applies a deletion", () => {
    expect(
      applyTextEdit("abc", {
        changes: [{ from: 1, to: 2, insert: "" }],
        selection,
      }),
    ).toBe("ac");
  });

  it("returns the text unchanged without changes", () => {
    expect(applyTextEdit("abc", { changes: [], selection })).toBe("abc");
  });
});
