import { describe, expect, it } from "vitest";
import { siblingMoveBefore } from "./sibling-move";

const LIST = ["a", "b", "c", "d"];

describe("siblingMoveBefore", () => {
  it("moves up before the previous sibling", () => {
    expect(siblingMoveBefore(LIST, "c", "up")).toEqual({ before: "b" });
    expect(siblingMoveBefore(LIST, "b", "up")).toEqual({ before: "a" });
  });

  it("moves down before the sibling after the next one", () => {
    expect(siblingMoveBefore(LIST, "a", "down")).toEqual({ before: "c" });
    expect(siblingMoveBefore(LIST, "b", "down")).toEqual({ before: "d" });
  });

  it("moves to the end when the next sibling is last", () => {
    expect(siblingMoveBefore(LIST, "c", "down")).toEqual({ before: null });
  });

  it("returns null at the ends", () => {
    expect(siblingMoveBefore(LIST, "a", "up")).toBeNull();
    expect(siblingMoveBefore(LIST, "d", "down")).toBeNull();
  });

  it("returns null for a missing name", () => {
    expect(siblingMoveBefore(LIST, "x", "up")).toBeNull();
    expect(siblingMoveBefore(LIST, "x", "down")).toBeNull();
  });

  it("handles a two-item list", () => {
    expect(siblingMoveBefore(["a", "b"], "a", "down")).toEqual({ before: null });
    expect(siblingMoveBefore(["a", "b"], "b", "up")).toEqual({ before: "a" });
    expect(siblingMoveBefore(["a", "b"], "a", "up")).toBeNull();
    expect(siblingMoveBefore(["a", "b"], "b", "down")).toBeNull();
  });

  it("returns null for a single item", () => {
    expect(siblingMoveBefore(["a"], "a", "up")).toBeNull();
    expect(siblingMoveBefore(["a"], "a", "down")).toBeNull();
  });
});
