// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markdownParser } from "../markdown/markdown-parser";
import { renderTableCellContent } from "./table-cell-content";

function renderCell(source: string): string {
  const text = `| h |\n| - |\n| ${source} |`;
  const tree = markdownParser.parse(text);
  const cells: ReturnType<typeof tree.resolve>[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "TableCell") cells.push(node.node);
    },
  });
  const cell = cells[cells.length - 1];
  const td = document.createElement("td");
  renderTableCellContent(td, cell, (from, to) => text.slice(from, to));
  return td.innerHTML;
}

describe("renderTableCellContent", () => {
  it("renders plain text", () => {
    expect(renderCell("plain words")).toBe("plain words");
  });

  it("renders emphasis, strong and strikethrough", () => {
    expect(renderCell("*a*")).toBe("<em>a</em>");
    expect(renderCell("**a**")).toBe("<strong>a</strong>");
    expect(renderCell("~~a~~")).toBe("<s>a</s>");
  });

  it("renders superscript and subscript", () => {
    expect(renderCell("x^2^")).toBe("x<sup>2</sup>");
    expect(renderCell("H~2~O")).toBe("H<sub>2</sub>O");
  });

  it("renders inline code unchanged", () => {
    expect(renderCell("`a *b* <c>`")).toBe("<code>a *b* &lt;c&gt;</code>");
  });

  it("mixes several kinds", () => {
    expect(renderCell("**a** and *b*")).toBe(
      "<strong>a</strong> and <em>b</em>",
    );
  });

  it("renders nested formatting", () => {
    expect(renderCell("**bold *both***")).toBe(
      "<strong>bold <em>both</em></strong>",
    );
  });

  it("renders a link with an openable destination", () => {
    expect(renderCell("[site](https://example.com)")).toBe(
      '<span class="cm-table-link" data-url="https://example.com">site</span>',
    );
  });

  it("drops the link title", () => {
    expect(renderCell('[site](https://example.com "Title")')).toBe(
      '<span class="cm-table-link" data-url="https://example.com">site</span>',
    );
  });

  it("renders formatting inside a link label", () => {
    expect(renderCell("[**site**](https://example.com)")).toBe(
      '<span class="cm-table-link" data-url="https://example.com"><strong>site</strong></span>',
    );
  });

  it("adds a scheme to a www link", () => {
    expect(renderCell("[site](www.example.com)")).toBe(
      '<span class="cm-table-link" data-url="https://www.example.com">site</span>',
    );
  });

  it("renders a link with a non-openable destination as its label", () => {
    expect(renderCell("[x](javascript:alert(1))")).toBe("x");
  });

  it("renders a reference link as its label", () => {
    expect(renderCell("[x][ref]")).toBe("x");
  });

  it("does not nest links for a URL-shaped label", () => {
    expect(renderCell("[https://a.com](https://b.com)")).toBe(
      '<span class="cm-table-link" data-url="https://b.com">https://a.com</span>',
    );
  });

  it("renders an autolink", () => {
    expect(renderCell("<https://example.com>")).toBe(
      '<span class="cm-table-link" data-url="https://example.com">https://example.com</span>',
    );
  });

  it("renders a bare URL", () => {
    expect(renderCell("see https://example.com now")).toBe(
      'see <span class="cm-table-link" data-url="https://example.com">https://example.com</span> now',
    );
  });

  it("renders an image as its alt text", () => {
    expect(renderCell("![a cat](cat.png)")).toBe("a cat");
  });

  it("renders an escaped pipe and other escapes", () => {
    expect(renderCell("a \\| b")).toBe("a | b");
    expect(renderCell("\\*x\\*")).toBe("*x*");
  });

  it("keeps an emoji shortcode as typed", () => {
    expect(renderCell(":smile:")).toBe(":smile:");
  });

  it("keeps an entity as source", () => {
    expect(renderCell("&amp;")).toBe("&amp;amp;");
  });

  it("keeps an HTML tag as source text", () => {
    expect(renderCell("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
});
