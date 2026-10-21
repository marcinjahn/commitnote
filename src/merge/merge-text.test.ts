import { describe, expect, it } from "vitest";
import { PLAIN_CONFLICT_LABELS } from "./conflict-labels";
import {
  CONFLICT_MARKER_PREFIX,
  conflictMarkerKind,
  mergeText,
} from "./merge-text";

const MINE_MARKER = `${CONFLICT_MARKER_PREFIX.mine} ${PLAIN_CONFLICT_LABELS.mine}`;
const SEPARATOR_MARKER = CONFLICT_MARKER_PREFIX.separator;
const THEIRS_MARKER = `${CONFLICT_MARKER_PREFIX.theirs} ${PLAIN_CONFLICT_LABELS.theirs}`;

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
      text: `a\n${MINE_MARKER}\nB1\n${SEPARATOR_MARKER}\nB2\n${THEIRS_MARKER}\nc`,
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
      text: `Before\nunchanged\n${MINE_MARKER}\nB1\n${SEPARATOR_MARKER}\nB2\n${THEIRS_MARKER}\nafter`,
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
      text: `${MINE_MARKER}\nmine content\n${SEPARATOR_MARKER}\ntheirs content\n${THEIRS_MARKER}`,
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

describe("mergeText labels", () => {
  it("emits custom labels, including odd characters, on the marker lines", () => {
    const result = mergeText("a\nb\nc", "a\nB1\nc", "a\nB2\nc", {
      mine: "This device · <é=ü> 日本",
      theirs: "Other device · >>>> ===",
    });

    expect(result).toEqual({
      kind: "conflict",
      text: "a\n<<<<<<< This device · <é=ü> 日本\nB1\n=======\nB2\n>>>>>>> Other device · >>>> ===\nc",
      hunks: [{ mine: "B1", base: "b", theirs: "B2" }],
    });
  });

  it("recognises every emitted marker line by prefix", () => {
    const result = mergeText("a\nb\nc", "a\nB1\nc", "a\nB2\nc", {
      mine: "x · <<<<<<<",
      theirs: "y · =======",
    });

    expect(result.text.split("\n").map(conflictMarkerKind)).toEqual([
      null,
      "mine",
      null,
      "separator",
      null,
      "theirs",
      null,
    ]);
  });
});

describe("conflictMarkerKind", () => {
  it.each([
    ["<<<<<<< This device", "mine"],
    ["<<<<<<< This device · Pixel app", "mine"],
    ["<<<<<<< mine", "mine"],
    ["<<<<<<<", "mine"],
    ["<<<<<<< mine\r", "mine"],
    ["=======", "separator"],
    ["=======\r", "separator"],
    [">>>>>>> Other device · Laptop", "theirs"],
    [">>>>>>> theirs", "theirs"],
    [">>>>>>>", "theirs"],
    [">>>>>>>\r", "theirs"],
  ] as const)("classifies %j as %s", (line, kind) => {
    expect(conflictMarkerKind(line)).toBe(kind);
  });

  it.each([
    "<<<<<<<<",
    "<<<<<<<x",
    "<<<<<<",
    "========",
    "=======x",
    ">>>>>>>>",
    ">>>>>>>x",
    " <<<<<<< mine",
    "text <<<<<<< mine",
    "",
  ])("rejects %j", (line) => {
    expect(conflictMarkerKind(line)).toBeNull();
  });
});
