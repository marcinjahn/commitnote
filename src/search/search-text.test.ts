import { describe, expect, it } from "vitest";
import {
  findOccurrences,
  fold,
  indexContent,
  isWordStart,
  mergeRanges,
  parseTerms,
  toSegments,
} from "./search-text";

describe("fold", () => {
  it.each<[string, string]>([
    ["Hello WORLD", "hello world"],
    ["Zażółć gęślą jaźń", "zazolc gesla jazn"],
    ["Café Ünïcödé", "cafe unicode"],
    ["ł", "l"],
    ["Ł", "l"],
    ["ø", "o"],
    ["Ø", "o"],
    ["đ", "d"],
    ["ı", "i"],
    ["", ""],
  ])("folds %j to %j", (input, expected) => {
    expect(fold(input)).toBe(expected);
  });

  it("keeps units whose lowercase form is longer than one unit", () => {
    expect(fold("İ")).toBe("İ");
  });

  it("leaves astral characters untouched", () => {
    expect(fold("a😀b")).toBe("a😀b");
    expect(fold("𝐀")).toBe("𝐀");
  });

  it.each(["Zażółć gęślą jaźń", "İstanbul", "a😀b 𝐀", "ŁØĐı", "é combining", "plain"])(
    "preserves length of %j",
    (input) => {
      expect(fold(input)).toHaveLength(input.length);
    },
  );
});

describe("parseTerms", () => {
  it("splits on whitespace runs", () => {
    expect(parseTerms("  foo \t bar\n\nbaz  ")).toEqual(["foo", "bar", "baz"]);
  });

  it("folds and dedupes preserving first occurrence", () => {
    expect(parseTerms("Żółć zolc ŻÓŁĆ other")).toEqual(["zolc", "other"]);
  });

  it("returns an empty list for blank queries", () => {
    expect(parseTerms("")).toEqual([]);
    expect(parseTerms("   \t ")).toEqual([]);
  });
});

describe("findOccurrences", () => {
  it("finds every occurrence left to right", () => {
    expect(findOccurrences("abcabcab", "ab")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it("does not return overlapping hits", () => {
    expect(findOccurrences("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns nothing when absent or term is empty", () => {
    expect(findOccurrences("abc", "x")).toEqual([]);
    expect(findOccurrences("abc", "")).toEqual([]);
  });
});

describe("mergeRanges", () => {
  it("sorts and merges overlapping and touching ranges", () => {
    expect(
      mergeRanges([
        { start: 10, end: 12 },
        { start: 0, end: 3 },
        { start: 3, end: 5 },
        { start: 4, end: 6 },
      ]),
    ).toEqual([
      { start: 0, end: 6 },
      { start: 10, end: 12 },
    ]);
  });

  it("keeps the larger end when a range is contained", () => {
    expect(
      mergeRanges([
        { start: 0, end: 10 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([{ start: 0, end: 10 }]);
  });

  it("handles empty input", () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe("toSegments", () => {
  it("handles a range at the start", () => {
    expect(toSegments("hello world", [{ start: 0, end: 5 }])).toEqual([
      { text: "hello", match: true },
      { text: " world", match: false },
    ]);
  });

  it("handles a range in the middle", () => {
    expect(toSegments("hello world", [{ start: 4, end: 7 }])).toEqual([
      { text: "hell", match: false },
      { text: "o w", match: true },
      { text: "orld", match: false },
    ]);
  });

  it("handles a range at the end", () => {
    expect(toSegments("hello world", [{ start: 6, end: 11 }])).toEqual([
      { text: "hello ", match: false },
      { text: "world", match: true },
    ]);
  });

  it("merges adjacent ranges into one match segment", () => {
    expect(
      toSegments("abcdef", [
        { start: 3, end: 5 },
        { start: 1, end: 3 },
      ]),
    ).toEqual([
      { text: "a", match: false },
      { text: "bcde", match: true },
      { text: "f", match: false },
    ]);
  });

  it("returns the whole text as plain without ranges and nothing for empty text", () => {
    expect(toSegments("abc", [])).toEqual([{ text: "abc", match: false }]);
    expect(toSegments("", [])).toEqual([]);
  });

  it("covers the whole text with a full range", () => {
    expect(toSegments("abc", [{ start: 0, end: 3 }])).toEqual([{ text: "abc", match: true }]);
  });
});

describe("isWordStart", () => {
  it("is true at index 0", () => {
    expect(isWordStart("abc", 0)).toBe(true);
  });

  it("is true after non-alphanumerics", () => {
    expect(isWordStart("foo bar", 4)).toBe(true);
    expect(isWordStart("foo-bar", 4)).toBe(true);
    expect(isWordStart("(bar", 1)).toBe(true);
  });

  it("is false inside words, including letters with diacritics and digits", () => {
    expect(isWordStart("foo", 1)).toBe(false);
    expect(isWordStart("żółć", 2)).toBe(false);
    expect(isWordStart("a1b", 2)).toBe(false);
  });
});

describe("indexContent", () => {
  it("keeps the original text next to its folded form", () => {
    expect(indexContent("Zażółć")).toEqual({ text: "Zażółć", folded: "zazolc" });
  });
});
