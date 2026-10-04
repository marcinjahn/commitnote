import { describe, expect, it } from "vitest";
import { showsPrintTitle } from "./print-markdown";

describe("showsPrintTitle", () => {
  it.each([
    ["ATX level 1", "# My Note\n\nbody\n"],
    ["ATX level 2", "## My Note\n\nbody\n"],
    ["Setext", "My Note\n=======\n\nbody\n"],
  ])("hides the title when a %s heading matches the name", (_, text) => {
    expect(showsPrintTitle("My Note", text)).toBe(false);
  });

  it("matches regardless of case and whitespace", () => {
    expect(showsPrintTitle("  my   note ", "#   MY Note  \n")).toBe(false);
  });

  it("matches a heading by its plain text", () => {
    expect(showsPrintTitle("My Note", "# My **Note**\n")).toBe(false);
    expect(
      showsPrintTitle(
        "My Note link",
        "# *My* `Note` [link](https://x.example)\n",
      ),
    ).toBe(false);
  });

  it("skips leading blank lines", () => {
    expect(showsPrintTitle("My Note", "\n\n  \n# My Note\n")).toBe(false);
  });

  it("shows the title when the first heading differs", () => {
    expect(showsPrintTitle("My Note", "# Other\n")).toBe(true);
  });

  it("shows the title when a paragraph comes first", () => {
    expect(showsPrintTitle("My Note", "My Note\n")).toBe(true);
  });

  it("shows the title when the matching heading follows other content", () => {
    expect(showsPrintTitle("My Note", "intro\n\n# My Note\n")).toBe(true);
  });

  it.each(["", "   "])("returns false for the name %j", (name) => {
    expect(showsPrintTitle(name, "# Title\n")).toBe(false);
  });

  it("shows the title for empty text", () => {
    expect(showsPrintTitle("My Note", "")).toBe(true);
  });
});
