import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { markdownParser } from "./markdown-parser";
import { readTable } from "./markdown-table";

function findNode(text: string, name: string): SyntaxNode {
  const cursor = markdownParser.parse(text).cursor();
  do {
    if (cursor.name === name) return cursor.node;
  } while (cursor.next());
  throw new Error(`no ${name} node`);
}

function read(text: string) {
  const model = readTable(findNode(text, "Table"), text);
  if (!model) throw new Error("not a table");
  return model;
}

function ranges(row: { cells: readonly { from: number; to: number }[] }) {
  return row.cells.map((cell) => [cell.from, cell.to]);
}

describe("readTable", () => {
  it("reads a basic table with absolute ranges", () => {
    const text = "intro\n\n| A | B |\n| - | - |\n| 1 | 22 |";
    const table = read(text);
    const headerStart = text.indexOf("| A");
    expect(table.from).toBe(headerStart);
    expect(table.to).toBe(text.length);
    expect(table.header.from).toBe(headerStart);
    expect(table.header.to).toBe(text.indexOf("\n| -"));
    expect(ranges(table.header)).toEqual([
      [text.indexOf("A"), text.indexOf("A") + 1],
      [text.indexOf("B"), text.indexOf("B") + 1],
    ]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].to).toBe(text.length);
    expect(ranges(table.rows[0])).toEqual([
      [text.indexOf("1"), text.indexOf("1") + 1],
      [text.indexOf("22"), text.indexOf("22") + 2],
    ]);
    expect(table.rows[0].cells.every((cell) => cell.node !== null)).toBe(true);
    expect(table.rows[0].cells[1].node?.name).toBe("TableCell");
  });

  it("reads all four alignments", () => {
    const table = read(
      "| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |",
    );
    expect(table.alignments).toEqual(["left", "center", "right", ""]);
  });

  it("keeps alignments at the column count", () => {
    expect(read("a | b | c\n-- | :-: | --:\n1 | 2 | 3").alignments).toEqual([
      "",
      "center",
      "right",
    ]);
    expect(read("| a | b |\n|:-:|--:|\n| 1 | 2 |").alignments).toEqual([
      "center",
      "right",
    ]);
  });

  it("pads a short row with empty cells at the row end", () => {
    const text = "| A | B | C |\n| - | - | - |\n| 1 |";
    const row = read(text).rows[0];
    expect(row.cells).toHaveLength(3);
    expect(row.cells[0].node).not.toBeNull();
    expect(row.cells[1]).toEqual({ from: row.to, to: row.to, node: null });
    expect(row.cells[2]).toEqual({ from: row.to, to: row.to, node: null });
  });

  it("truncates a long row to the column count", () => {
    const text = "| A | B |\n| - | - |\n| 1 | 2 | 3 | 4 |";
    const row = read(text).rows[0];
    expect(row.cells).toHaveLength(2);
    expect(row.cells.map((cell) => text.slice(cell.from, cell.to))).toEqual([
      "1",
      "2",
    ]);
  });

  it("represents an empty middle cell by its segment", () => {
    const text = "| A | B | C |\n| - | - | - |\n| 1 |  | 3 |";
    const row = read(text).rows[0];
    const lineStart = text.lastIndexOf("\n") + 1;
    expect(row.cells[1].node).toBeNull();
    expect([row.cells[1].from, row.cells[1].to]).toEqual([
      lineStart + 5,
      lineStart + 7,
    ]);
    expect(text.slice(row.cells[2].from, row.cells[2].to)).toBe("3");
  });

  it("reads rows without leading or trailing pipes", () => {
    const text = "A | B\n-- | --\n1 | 2";
    const table = read(text);
    expect(table.header.cells.map((c) => text.slice(c.from, c.to))).toEqual([
      "A",
      "B",
    ]);
    expect(table.rows[0].cells.map((c) => text.slice(c.from, c.to))).toEqual([
      "1",
      "2",
    ]);
  });

  it("keeps an escaped pipe inside one cell", () => {
    const text = "| A | B |\n| - | - |\n| x \\| y | 2 |";
    const row = read(text).rows[0];
    expect(row.cells).toHaveLength(2);
    expect(text.slice(row.cells[0].from, row.cells[0].to)).toBe("x \\| y");
    expect(text.slice(row.cells[1].from, row.cells[1].to)).toBe("2");
  });

  it("reads a header-only table", () => {
    const table = read("| A | B |\n| - | - |");
    expect(table.rows).toEqual([]);
    expect(table.header.cells).toHaveLength(2);
  });

  it("returns null for a node that is not a table", () => {
    const text = "just a paragraph";
    expect(readTable(findNode(text, "Paragraph"), text)).toBeNull();
  });
});
