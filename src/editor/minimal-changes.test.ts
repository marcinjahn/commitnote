import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { DIFF_MAX_LINES } from "../history/line-diff";
import { minimalChanges } from "./minimal-changes";

function apply(oldText: string, newText: string): string {
  const changes = minimalChanges(oldText, newText);
  return EditorState.create({ doc: oldText })
    .update({ changes })
    .state.doc.toString();
}

describe("minimalChanges", () => {
  it.each([
    ["identical texts", "a\nb\n", "a\nb\n"],
    ["insert at start", "b\nc\n", "a\nb\nc\n"],
    ["insert in the middle", "a\nc\n", "a\nb\nc\n"],
    ["insert at end", "a\nb\n", "a\nb\nc\n"],
    ["delete", "a\nb\nc\n", "a\nc\n"],
    ["change inside one line", "hello world\nx\n", "hello brave world\nx\n"],
    [
      "multi-line changes in several places",
      "a\nb\nc\nd\ne\nf\ng\n",
      "a\nB\nB2\nc\nd\ne\nF\ng\nh\n",
    ],
    ["missing trailing newline in old", "a\nb", "a\nb\nc\n"],
    ["missing trailing newline in new", "a\nb\n", "a\nb"],
    ["missing trailing newline in both", "a\nb", "a\nc"],
    ["empty old text", "", "a\nb\n"],
    ["empty new text", "a\nb\n", ""],
    ["repeated lines", "a\na\na\n", "a\na\n"],
    ["boundary inside a line", "abcdef\nxyz\n", "abXYef\nxyz\n"],
    ["blank lines", "\n\n\n", "\nx\n\n"],
  ])("round-trips: %s", (_name, oldText, newText) => {
    expect(apply(oldText, newText)).toBe(newText);
  });

  it("returns no changes for equal texts", () => {
    expect(minimalChanges("same\n", "same\n")).toEqual([]);
  });

  it("does not cover unchanged lines between distant edits", () => {
    const middle = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const oldText = ["first", ...middle, "last"].join("\n");
    const newText = ["FIRST", ...middle, "LAST"].join("\n");

    const changes = minimalChanges(oldText, newText);

    expect(changes.length).toBeGreaterThan(1);
    for (const change of changes) {
      const { from, to } = change as { from: number; to: number };
      expect(to - from).toBeLessThan(10);
    }
    expect(apply(oldText, newText)).toBe(newText);
  });

  it("falls back to a single change above the line cap", () => {
    const lines = Array.from({ length: DIFF_MAX_LINES + 5 }, (_, i) => `l${i}`);
    const oldText = ["start", ...lines, "mid", ...lines, "end"].join("\n");
    const newText = ["START", ...lines, "MID", ...lines, "END"].join("\n");

    expect(minimalChanges(oldText, newText)).toHaveLength(1);
    expect(apply(oldText, newText)).toBe(newText);
  });
});
