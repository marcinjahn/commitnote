import { describe, expect, it } from "vitest";
import {
  DIFF_MAX_LINES,
  diffNote,
  type DiffItem,
  type NoteDiff,
} from "./line-diff";

function lines(count: number, prefix = "line"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

function render(diff: NoteDiff): string[] {
  if (diff.kind !== "diff") throw new Error("expected a diff");
  return diff.items.map((item: DiffItem) => {
    if (item.kind === "fold") return `~ ${item.lines.length}`;
    const { line } = item;
    if (line.kind === "same") return `  ${line.text}`;
    const text = line.segments
      .map((s) => (s.changed ? `[${s.text}]` : s.text))
      .join("");
    return `${line.kind === "added" ? "+" : "-"} ${text}`;
  });
}

describe("diffNote", () => {
  it("reports no changes for identical notes", () => {
    expect(diffNote("a\nb\n", "a\nb\n")).toEqual({
      kind: "diff",
      items: [],
      added: 0,
      removed: 0,
      finalNewline: null,
    });
  });

  it("lists removed lines before added ones and counts them", () => {
    const diff = diffNote("a\nold\nb", "a\nnew\nextra\nb");

    expect(render(diff)).toEqual(["  a", "- old", "+ new", "+ extra", "  b"]);
    expect(diff).toMatchObject({ added: 2, removed: 1 });
  });

  it("marks the differing words of an edited line", () => {
    const diff = diffNote("buy milk and bread", "buy oat milk and bread");

    expect(render(diff)).toEqual([
      "- buy milk and bread",
      "+ buy [oat ]milk and bread",
    ]);
  });

  it("does not mark words when an edited line shares none with the other", () => {
    expect(render(diffNote("alpha beta", "gamma delta"))).toEqual([
      "- alpha beta",
      "+ gamma delta",
    ]);
  });

  it("keeps three lines of context and folds the rest", () => {
    const current = lines(20);
    const selected = [...current];
    selected[9] = "changed";

    expect(render(diffNote(current.join("\n"), selected.join("\n")))).toEqual([
      "~ 6",
      "  line 7",
      "  line 8",
      "  line 9",
      "- line 10",
      "+ changed",
      "  line 11",
      "  line 12",
      "  line 13",
      "~ 7",
    ]);
  });

  it("folds a long unchanged run between two changes, keeping context on both sides", () => {
    const current = lines(30);
    const selected = [...current];
    selected[0] = "first";
    selected[29] = "last";

    expect(render(diffNote(current.join("\n"), selected.join("\n")))).toEqual([
      "- line 1",
      "+ first",
      "  line 2",
      "  line 3",
      "  line 4",
      "~ 22",
      "  line 27",
      "  line 28",
      "  line 29",
      "- line 30",
      "+ last",
    ]);
  });

  it("shows a single line instead of folding it", () => {
    const current = lines(5);
    const selected = [...current];
    selected[4] = "changed";

    expect(render(diffNote(current.join("\n"), selected.join("\n")))).toEqual([
      "  line 1",
      "  line 2",
      "  line 3",
      "  line 4",
      "- line 5",
      "+ changed",
    ]);
  });

  it("reports a change of the final line break without an empty line", () => {
    expect(diffNote("a\nb", "a\nb\n")).toMatchObject({
      items: [],
      added: 0,
      removed: 0,
      finalNewline: "added",
    });
    expect(diffNote("a\nb\n", "a\nb")).toMatchObject({
      finalNewline: "removed",
    });
  });

  it("treats an empty note as having no lines", () => {
    const diff = diffNote("", "one\ntwo\n");

    expect(render(diff)).toEqual(["+ one", "+ two"]);
    expect(diff).toMatchObject({ added: 2, removed: 0, finalNewline: "added" });
    expect(render(diffNote("one", ""))).toEqual(["- one"]);
  });

  it("refuses notes with too many lines", () => {
    const huge = lines(DIFF_MAX_LINES + 1).join("\n");

    expect(diffNote(huge, "short")).toEqual({ kind: "tooLarge" });
    expect(diffNote("short", huge)).toEqual({ kind: "tooLarge" });
  });
});
