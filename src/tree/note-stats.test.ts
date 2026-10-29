import { describe, expect, it } from "vitest";
import { countTasks, countWords } from "./note-stats";

describe("countWords", () => {
  it("counts English prose", () => {
    expect(countWords("The quick brown fox, jumps over it.", "en-GB")).toBe(7);
  });

  it("ignores markdown punctuation", () => {
    expect(countWords("# Title\n\n- **one** two\n> three", "en-GB")).toBe(4);
  });

  it("segments CJK text into several words", () => {
    expect(countWords("今日は良い天気です", "ja")).toBe(5);
  });

  it("ignores image references including their alt text", () => {
    expect(
      countWords("two words ![alt text here](image:s4u5q5zr4xaec3jewbaixgwlou#10x10)", "en-GB"),
    ).toBe(2);
  });

  it("still counts a reference inside a fenced code block", () => {
    expect(
      countWords("```\n![alt](image:s4u5q5zr4xaec3jewbaixgwlou#10x10)\n```", "en-GB"),
    ).toBeGreaterThan(0);
  });

  it("counts nothing for empty or whitespace-only text", () => {
    expect(countWords("", "en-GB")).toBe(0);
    expect(countWords(" \n\t ", "en-GB")).toBe(0);
  });
});

describe("countTasks", () => {
  it("counts nothing when there are no tasks", () => {
    expect(countTasks("")).toEqual({ done: 0, total: 0 });
    expect(countTasks("# Title\n\n- item\n- other")).toEqual({
      done: 0,
      total: 0,
    });
  });

  it("counts open and done tasks", () => {
    expect(countTasks("- [ ] a\n- [x] b\n- [X] c")).toEqual({
      done: 2,
      total: 3,
    });
  });

  it("counts nested tasks", () => {
    expect(countTasks("- [x] a\n  - [ ] b\n  - [x] c\n    1. [ ] d")).toEqual({
      done: 2,
      total: 4,
    });
  });

  it("ignores task syntax in inline code", () => {
    expect(countTasks("- text `- [ ] a` more\n- [x] b")).toEqual({
      done: 1,
      total: 1,
    });
  });

  it("ignores task syntax in fenced code blocks", () => {
    expect(countTasks("```\n- [ ] a\n- [x] b\n```\n- [ ] c")).toEqual({
      done: 0,
      total: 1,
    });
  });

  it("ignores brackets that are not list tasks", () => {
    expect(countTasks("[x] not a task\n\ntext [ ] here")).toEqual({
      done: 0,
      total: 0,
    });
  });
});
