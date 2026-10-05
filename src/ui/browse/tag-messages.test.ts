import { describe, expect, it } from "vitest";
import type { ColorTag } from "../../tags/color-tag";
import { describeColorTag } from "./tag-messages";

describe("describeColorTag", () => {
  it.each<[ColorTag, string]>([
    ["red", "Red tag"],
    ["orange", "Orange tag"],
    ["yellow", "Yellow tag"],
    ["green", "Green tag"],
    ["blue", "Blue tag"],
    ["purple", "Purple tag"],
  ])("describes %s", (tag, expected) => {
    expect(describeColorTag(tag)).toBe(expected);
  });
});
