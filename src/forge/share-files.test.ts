import { describe, expect, it } from "vitest";
import {
  SHARE_FILE,
  isShareImageFileName,
  shareContentFiles,
  shareImageFileName,
} from "./share-files";

describe("share files", () => {
  it("names image files by index", () => {
    expect(shareImageFileName(0)).toBe("commitnote-image-0.json");
    expect(shareImageFileName(12)).toBe("commitnote-image-12.json");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects index %s",
    (index) => {
      expect(() => shareImageFileName(index)).toThrow(RangeError);
    },
  );

  it("recognizes image file names", () => {
    expect(isShareImageFileName("commitnote-image-0.json")).toBe(true);
    expect(isShareImageFileName("commitnote-image-19.json")).toBe(true);
  });

  it.each([
    SHARE_FILE,
    "commitnote-image-01.json",
    "commitnote-image-.json",
    "commitnote-image--1.json",
    "commitnote-image-1.json.bak",
    "x/commitnote-image-1.json",
    "commitnote-image-1.JSON",
  ])("rejects %s", (name) => {
    expect(isShareImageFileName(name)).toBe(false);
  });

  it("maps content to files", () => {
    expect(shareContentFiles({ envelope: "e", images: ["a", "b"] })).toEqual({
      [SHARE_FILE]: "e",
      "commitnote-image-0.json": "a",
      "commitnote-image-1.json": "b",
    });
    expect(shareContentFiles({ envelope: "e", images: [] })).toEqual({
      [SHARE_FILE]: "e",
    });
  });
});
