import { describe, expect, it } from "vitest";
import { CONFLICT_MARKERS, mergeText } from "./merge-text";

describe("mergeText", () => {
  it("merges non-overlapping edits on different lines cleanly", () => {
    const base = "a\nb\nc\n";
    const mine = "A\nb\nc\n";
    const theirs = "a\nb\nC\n";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({ kind: "clean", text: "A\nb\nC\n" });
  });

  it("merges the same edit on both sides cleanly, without a conflict", () => {
    const base = "a\nb\nc\nd";
    const mine = "a\nB\nc\nd\ne";
    const theirs = "a\nB\nc\nd";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({ kind: "clean", text: "a\nB\nc\nd\ne" });
  });

  it("produces the exact conflict marker text and hunks for overlapping edits", () => {
    const base = "a\nb\nc";
    const mine = "a\nB1\nc";
    const theirs = "a\nB2\nc";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({
      kind: "conflict",
      text: `a\n${CONFLICT_MARKERS.mine}\nB1\n${CONFLICT_MARKERS.separator}\nB2\n${CONFLICT_MARKERS.theirs}\nc`,
      hunks: [{ mine: "B1", base: "b", theirs: "B2" }],
    });
  });

  it("preserves a non-conflicting edit adjacent to a conflict", () => {
    const base = "before\nunchanged\nconflict\nafter";
    const mine = "Before\nunchanged\nB1\nafter";
    const theirs = "before\nunchanged\nB2\nafter";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({
      kind: "conflict",
      text: `Before\nunchanged\n${CONFLICT_MARKERS.mine}\nB1\n${CONFLICT_MARKERS.separator}\nB2\n${CONFLICT_MARKERS.theirs}\nafter`,
      hunks: [{ mine: "B1", base: "conflict", theirs: "B2" }],
    });
  });

  it("preserves a trailing newline when it is present", () => {
    const base = "a\nb\nc\n";
    const mine = "A\nb\nc\n";
    const theirs = "a\nb\nC\n";

    const result = mergeText(base, mine, theirs);

    expect(result.text).toBe("A\nb\nC\n");
  });

  it("preserves the absence of a trailing newline", () => {
    const base = "a\nb\nc";
    const mine = "A\nb\nc";
    const theirs = "a\nb\nC";

    const result = mergeText(base, mine, theirs);

    expect(result.text).toBe("A\nb\nC");
  });

  it("conflicts when an empty base gets two different creations", () => {
    const base = "";
    const mine = "mine content";
    const theirs = "theirs content";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({
      kind: "conflict",
      text: `${CONFLICT_MARKERS.mine}\nmine content\n${CONFLICT_MARKERS.separator}\ntheirs content\n${CONFLICT_MARKERS.theirs}`,
      hunks: [{ mine: "mine content", base: "", theirs: "theirs content" }],
    });
  });

  it("merges cleanly when an empty base gets identical creations", () => {
    const base = "";
    const mine = "same content";
    const theirs = "same content";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({ kind: "clean", text: "same content" });
  });

  it("survives \\r\\n line endings through a clean merge unchanged", () => {
    const base = "a\r\nb\r\nc\r\n";
    const mine = "A\r\nb\r\nc\r\n";
    const theirs = "a\r\nb\r\nC\r\n";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({ kind: "clean", text: "A\r\nb\r\nC\r\n" });
  });

  it("merges a deletion against an untouched line cleanly", () => {
    const base = "a\nb\nanchor\nc";
    const mine = "a\nanchor\nc";
    const theirs = "a\nb\nanchor\nC";

    const result = mergeText(base, mine, theirs);

    expect(result).toEqual({ kind: "clean", text: "a\nanchor\nC" });
  });
});
