import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { tailClusters } from "./caret-tail";

function tail(doc: string, caret = doc.length) {
  const state = EditorState.create({ doc });
  return tailClusters(state, caret).map(({ from, to, ink }) => ({
    text: state.doc.sliceString(from, to),
    ink,
  }));
}

const tailText = (doc: string, caret?: number) =>
  tail(doc, caret).map(({ text }) => text);

const inked = (doc: string, caret?: number) =>
  tail(doc, caret)
    .filter(({ ink }) => ink)
    .map(({ text }) => text);

describe("tailClusters", () => {
  it("takes the last three characters before the caret", () => {
    expect(tailText("keeps typing")).toEqual(["i", "n", "g"]);
    expect(inked("keeps typing")).toEqual(["i", "n", "g"]);
  });

  it("is empty at the start of a line", () => {
    expect(tailText("first\nsecond", "first\n".length)).toEqual([]);
  });

  it("counts a space as a position with nothing to tint", () => {
    expect(tailText("word ")).toEqual(["r", "d", " "]);
    expect(inked("word ")).toEqual(["r", "d"]);
  });

  it("leaves one letter after two spaces", () => {
    expect(tailText("word  ")).toEqual(["d", " ", " "]);
    expect(inked("word  ")).toEqual(["d"]);
  });

  it("tints nothing after three spaces", () => {
    expect(inked("word   ")).toEqual([]);
  });

  it("counts a tab like a space", () => {
    expect(tailText("word\t")).toEqual(["r", "d", "\t"]);
    expect(inked("word\t")).toEqual(["r", "d"]);
  });

  it("runs across words", () => {
    expect(inked("a to")).toEqual(["t", "o"]);
    expect(tailText("a to")).toEqual([" ", "t", "o"]);
  });

  it("only looks at the caret's line", () => {
    expect(tailText("ab\ncd", "ab\nc".length)).toEqual(["c"]);
  });

  it("keeps combining marks with their letter", () => {
    expect(tailText("jaźń")).toEqual(["a", "ź", "ń"]);
  });

  it("counts an emoji as a position it cannot tint", () => {
    expect(tailText("party 🎉")).toEqual(["y", " ", "🎉"]);
    expect(inked("party 🎉")).toEqual(["y"]);
  });

  it("includes visible markdown syntax", () => {
    expect(tailText("**bold**")).toEqual(["d", "*", "*"]);
  });
});
