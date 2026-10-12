import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { tailClusters } from "./caret-tail";

function tailText(doc: string, caret = doc.length): string[] {
  const state = EditorState.create({ doc });
  return tailClusters(state, caret).map(({ from, to }) =>
    state.doc.sliceString(from, to),
  );
}

describe("tailClusters", () => {
  it("takes the last three characters before the caret", () => {
    expect(tailText("keeps typing")).toEqual(["i", "n", "g"]);
  });

  it("is empty at the start of a line", () => {
    expect(tailText("first\nsecond", "first\n".length)).toEqual([]);
  });

  it("is empty right after whitespace", () => {
    expect(tailText("word ")).toEqual([]);
  });

  it("stops at the word boundary for short words", () => {
    expect(tailText("a to")).toEqual(["t", "o"]);
  });

  it("only looks at the caret's line", () => {
    expect(tailText("ab\ncd", "ab\nc".length)).toEqual(["c"]);
  });

  it("keeps combining marks with their letter", () => {
    expect(tailText("jaźń")).toEqual(["a", "ź", "ń"]);
  });

  it("skips emoji, which cannot be tinted", () => {
    expect(tailText("party 🎉")).toEqual([]);
  });

  it("includes visible markdown syntax", () => {
    expect(tailText("**bold**")).toEqual(["d", "*", "*"]);
  });
});
