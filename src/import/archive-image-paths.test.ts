import { describe, expect, it } from "vitest";
import {
  isArchiveImagePath,
  resolveArchiveImagePath,
} from "./archive-image-paths";

describe("resolveArchiveImagePath", () => {
  const cases: [string, string[], string, string | null][] = [
    ["same folder", ["A", "B"], "a.png", "A/B/a.png"],
    ["subfolder", ["A"], "pics/a.png", "A/pics/a.png"],
    ["parent folder", ["A", "B"], "../x.png", "A/x.png"],
    ["above root from root note", [], "../x.png", null],
    ["above root from nested note", ["A"], "../../x.png", null],
    ["dot segments and upper case extension", [], "./a/b.PNG", "a/b.PNG"],
    ["dot segment in the middle", ["A"], "a/./b.png", "A/a/b.png"],
    ["query and fragment dropped", [], "pics/a.png?raw=1#frag", "pics/a.png"],
    ["fragment dropped", [], "a.png#x", "a.png"],
    ["percent-encoded space", [], "my%20pic.png", "my pic.png"],
    ["percent-encoded unicode", [], "%E2%82%AC.png", "€.png"],
    ["angle brackets", [], "<my pic.png>", "my pic.png"],
    ["NFD normalized to NFC", [], "e\u0301.png", "\u00e9.png"],
    ["case is not folded", [], "A/B.PNG", "A/B.PNG"],
    ["malformed escape", [], "bad%zz.png", null],
    ["https url", [], "https://x/a.png", null],
    ["data url", [], "data:image/png;base64,AAAA", null],
    ["file url", [], "file:///a.png", null],
    ["image reference", [], "image:abcdefghijklmnopqrstuvwxyz#1x1", null],
    ["absolute path", [], "/abs.png", null],
    ["fragment only", [], "#a.png", null],
    ["empty", [], "", null],
    ["backslash", [], "a\\b.png", null],
    ["encoded backslash", [], "a%5Cb.png", null],
    ["empty segment", [], "a//b.png", null],
    ["encoded slash prefix", [], "%2Fabs.png", null],
    ["not an image", [], "doc.pdf", null],
    ["svg", [], "a.svg", null],
    ["no extension", [], "a", null],
    ["directory", [], "pics/", null],
  ];

  it.each(cases)("%s", (_name, folder, url, expected) => {
    expect(resolveArchiveImagePath(folder, url)).toBe(expected);
  });
});

describe("isArchiveImagePath", () => {
  it.each(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"])(
    "accepts %s in any case",
    (extension) => {
      expect(isArchiveImagePath(`A/a.${extension}`)).toBe(true);
      expect(isArchiveImagePath(`A/a.${extension.toUpperCase()}`)).toBe(true);
    },
  );

  it("rejects other files", () => {
    expect(isArchiveImagePath("a.svg")).toBe(false);
    expect(isArchiveImagePath("png")).toBe(false);
    expect(isArchiveImagePath("A.png/readme")).toBe(false);
    expect(isArchiveImagePath("a.png.txt")).toBe(false);
  });
});
