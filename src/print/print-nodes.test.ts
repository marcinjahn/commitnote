import { describe, expect, it } from "vitest";
import { renderPrintHtml } from "./print-nodes";

function render(md: string): string {
  return renderPrintHtml(md, new Map());
}

describe("renderPrintHtml tables", () => {
  it("renders a basic table", () => {
    const md = [
      "| Column A | Column B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
    ].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr><th>Column A</th><th>Column B</th></tr></thead>" +
        "<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>",
    );
  });

  it("applies column alignments to header and body cells", () => {
    const md = [
      "| L | C | R | N |",
      "| :-- | :-: | --: | --- |",
      "| 1 | 2 | 3 | 4 |",
    ].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr>" +
        '<th style="text-align: left;">L</th>' +
        '<th style="text-align: center;">C</th>' +
        '<th style="text-align: right;">R</th>' +
        "<th>N</th>" +
        "</tr></thead><tbody><tr>" +
        '<td style="text-align: left;">1</td>' +
        '<td style="text-align: center;">2</td>' +
        '<td style="text-align: right;">3</td>' +
        "<td>4</td>" +
        "</tr></tbody></table>",
    );
  });

  it("pads short rows and drops cells beyond the header", () => {
    const md = [
      "| A | B | C |",
      "| --- | --- | --- |",
      "| a |",
      "| a | b | c | d |",
      "| a |  | c |",
    ].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody>" +
        "<tr><td>a</td><td></td><td></td></tr>" +
        "<tr><td>a</td><td>b</td><td>c</td></tr>" +
        "<tr><td>a</td><td></td><td>c</td></tr>" +
        "</tbody></table>",
    );
  });

  it("omits tbody for a header-only table", () => {
    const md = ["| A | B |", "| --- | --- |"].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead></table>",
    );
  });

  it("keeps an escaped pipe inside its cell", () => {
    const md = ["| A | B |", "| --- | --- |", "| a \\| b | c |"].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>" +
        "<tbody><tr><td>a | b</td><td>c</td></tr></tbody></table>",
    );
  });

  it("renders inline content in cells", () => {
    const md = [
      "| A | B | C | D | E | F | G | H | I |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| **bold** | *italic* | ~~gone~~ | `code` | [site](https://example.com) | ![chart](image:aaaaaaaaaaaaaaaaaaaaaaaaaa#40x30) | H~2~O | x^2^ | :smile: |",
    ].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr>" +
        "<th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th><th>G</th><th>H</th><th>I</th>" +
        "</tr></thead><tbody><tr>" +
        "<td><strong>bold</strong></td>" +
        "<td><em>italic</em></td>" +
        "<td><s>gone</s></td>" +
        "<td><code>code</code></td>" +
        '<td><a href="https://example.com">site</a><span class="print-url"> (https://example.com)</span></td>' +
        '<td><span class="print-image-unavailable">chart (Image unavailable)</span></td>' +
        "<td>H~2~O</td>" +
        "<td>x^2^</td>" +
        "<td>:smile:</td>" +
        "</tr></tbody></table>",
    );
  });

  it("renders rows without outer pipes", () => {
    const md = ["a | b", "--|--", "1 | 2"].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });

  it("does not render a table when the delimiter row has a different column count", () => {
    const md = ["| a | b |", "| --- |", "| 1 | 2 |"].join("\n");
    expect(render(md)).toBe("<p>| a | b |<br>| --- |<br>| 1 | 2 |</p>");
  });

  it("renders a table inside a blockquote and inside a list item", () => {
    const quoted = ["> | a | b |", "> | --- | --- |", "> | 1 | 2 |"].join("\n");
    expect(render(quoted)).toBe(
      "<blockquote><table><thead><tr><th>a</th><th>b</th></tr></thead>" +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></blockquote>",
    );

    const listed = [
      "- item",
      "",
      "  | a | b |",
      "  | --- | --- |",
      "  | 1 | 2 |",
    ].join("\n");
    expect(render(listed)).toBe(
      "<ul><li><p>item</p><table><thead><tr><th>a</th><th>b</th></tr></thead>" +
        "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></li></ul>",
    );
  });

  it("turns a non-blank line after a table into a body row", () => {
    const md = ["| a |", "| - |", "next"].join("\n");
    expect(render(md)).toBe(
      "<table><thead><tr><th>a</th></tr></thead>" +
        "<tbody><tr><td>next</td></tr></tbody></table>",
    );
  });
});
