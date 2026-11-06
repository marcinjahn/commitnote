import { describe, expect, it } from "vitest";
import {
  cellAt,
  tableSourceAt,
  tableSpans,
  type SourceLine,
  type TableSource,
} from "./table-source";

function source(text: string, position = 0): TableSource {
  const table = tableSourceAt(text, position);
  if (!table) throw new Error("no table");
  return table;
}

function texts(line: SourceLine): string[] {
  return line.cells.map((cell) => cell.text);
}

describe("tableSourceAt location", () => {
  const text = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter";
  const from = text.indexOf("| a");
  const to = text.indexOf("\n\nafter");

  it("spans from the header line start to the last line end", () => {
    const table = source(text, from);
    expect([table.lines[0].from, table.lines.at(-1)!.to]).toEqual([from, to]);
  });

  it("finds the table from a position on each line", () => {
    for (const marker of ["a |", "- |", "1 |"]) {
      expect(tableSourceAt(text, text.indexOf(marker))?.lines[0].from).toBe(
        from,
      );
    }
  });

  it("includes the header line start and the last line end", () => {
    expect(tableSourceAt(text, from)?.lines[0].from).toBe(from);
    expect(tableSourceAt(text, to)?.lines[0].from).toBe(from);
  });

  it("excludes the lines before and after the table", () => {
    expect(tableSourceAt(text, from - 1)).toBeNull();
    expect(tableSourceAt(text, to + 1)).toBeNull();
  });

  it("returns null when header and delimiter cell counts differ", () => {
    expect(tableSourceAt("| a | b |\n| - |\n| 1 | 2 |", 0)).toBeNull();
  });

  it("reads the column count", () => {
    const table = source("| a | b | c |\n| :- | :-: | -: |");
    expect(table.columnCount).toBe(3);
  });
});

describe("tableSpans", () => {
  it("lists every table at any nesting in document order", () => {
    const text =
      "| a |\n| - |\n\ntext\n\n> | b |\n> | - |\n> | 1 |\n\n- item\n\n  | c |\n  | - |";
    expect(tableSpans(text)).toEqual([
      { from: 0, to: 11 },
      { from: text.indexOf("> | b"), to: text.indexOf("\n\n- item") },
      { from: text.indexOf("  | c"), to: text.length },
    ]);
  });

  it("returns no spans for text without tables", () => {
    expect(tableSpans("just a paragraph | with a pipe")).toEqual([]);
  });
});

describe("tableSourceAt cells", () => {
  it("reads segments between leading and trailing pipes", () => {
    const table = source("| a | b |\n| :- | -: |\n| 1 | 2 |");
    const header = table.lines[0];
    expect(header).toMatchObject({
      from: 0,
      to: 9,
      rowFrom: 0,
      trailingPipe: true,
    });
    expect(header.cells).toEqual([
      { from: 1, to: 4, contentTo: 3, text: "a" },
      { from: 5, to: 8, contentTo: 7, text: "b" },
    ]);
    expect(texts(table.lines[2])).toEqual(["1", "2"]);
  });

  it("reads segments of rows without leading and trailing pipes", () => {
    const table = source("a | b\n-- | --\n1 | 2");
    const header = table.lines[0];
    expect(header.trailingPipe).toBe(false);
    expect(header.cells).toEqual([
      { from: 0, to: 2, contentTo: 1, text: "a" },
      { from: 3, to: 5, contentTo: 5, text: "b" },
    ]);
    expect(texts(table.lines[1])).toEqual(["--", "--"]);
    expect(texts(table.lines[2])).toEqual(["1", "2"]);
  });

  it("splits the delimiter line on its pipes", () => {
    const text = "| a | b |\n| :- | -: |";
    const delimiter = source(text).lines[1];
    expect(delimiter).toMatchObject({
      from: 10,
      to: text.length,
      rowFrom: 10,
      trailingPipe: true,
    });
    expect(delimiter.cells).toEqual([
      { from: 11, to: 15, contentTo: 14, text: ":-" },
      { from: 16, to: 20, contentTo: 19, text: "-:" },
    ]);
  });

  it("treats whitespace after the trailing pipe as no cell", () => {
    const table = source("| a | b |  \n| - | - |");
    expect(table.columnCount).toBe(2);
    expect(table.lines[0].trailingPipe).toBe(true);
    expect(table.lines[0].to).toBe(11);
  });

  it("gives an empty cell an empty content range at its start", () => {
    const text = "| a | b |\n| - | - |\n|   | 2 |";
    const cell = source(text).lines[2].cells[0];
    const start = text.lastIndexOf("\n") + 2;
    expect(cell).toEqual({
      from: start,
      to: start + 3,
      contentTo: start,
      text: "",
    });
  });

  it("keeps an escaped pipe inside one cell, also inside a code span", () => {
    const table = source("| a | b |\n| - | - |\n| x \\| y | `c\\|d` |");
    expect(texts(table.lines[2])).toEqual(["x \\| y", "`c\\|d`"]);
  });

  it("splits cells on an unescaped pipe inside backticks", () => {
    const table = source("| a | b |\n| - | - |\n| `x|y` |");
    expect(texts(table.lines[2])).toEqual(["`x", "y`"]);
  });

  it("keeps extra cells beyond the header count", () => {
    const table = source("| a |\n| - |\n| 1 | 2 | 3 |");
    expect(table.columnCount).toBe(1);
    expect(texts(table.lines[2])).toEqual(["1", "2", "3"]);
  });
});

describe("tableSourceAt prefixes", () => {
  it.each<[string, string, string | null, string[]]>([
    ["indented top level", "  | a |\n  | - |\n  | 1 |", "", ["  ", "  ", "  "]],
    ["blockquote", "> | a |\n> | - |\n> | 1 |", "> ", ["> ", "> ", "> "]],
    [
      "two-level blockquote",
      "> > | a |\n> > | - |\n> > | 1 |",
      "> > ",
      ["> > ", "> > ", "> > "],
    ],
    [
      "list item",
      "- item\n\n  | a |\n  | - |\n  | 1 |",
      "  ",
      ["  ", "  ", "  "],
    ],
    [
      "irregular lazy blockquote line",
      "> | a | b |\n> | - | - |\n| 1 | 2 |",
      null,
      ["> ", "> ", ""],
    ],
  ])("%s", (_name, text, prefix, leads) => {
    const table = source(text, text.lastIndexOf("| a"));
    expect(table.prefix).toBe(prefix);
    expect(
      table.lines.map((line) => text.slice(line.from, line.rowFrom)),
    ).toEqual(leads);
    for (const line of table.lines) {
      expect(line.cells[0].text).not.toBe("");
    }
  });
});

describe("cellAt", () => {
  const text = "| ab | cd |\n| -- | -- |\n| 1 | 2 | xyz |\n|";
  const table = source(text);

  it.each<[number, number]>([
    [0, 0],
    [1, 0],
    [3, 0],
    [4, 0],
    [5, 0],
    [6, 1],
    [8, 1],
    [10, 1],
    [11, 1],
  ])("maps header position %i to column %i", (position, column) => {
    expect(cellAt(table, position)).toEqual({ line: 0, column });
  });

  it("maps a delimiter line position to its line and column", () => {
    expect(cellAt(table, text.indexOf("-- |", 15))).toEqual({
      line: 1,
      column: 1,
    });
  });

  it("maps an extra cell to the last regular column", () => {
    expect(cellAt(table, text.indexOf("yz"))).toEqual({ line: 2, column: 1 });
  });

  it("maps a position past the row's cells to column 0", () => {
    expect(cellAt(table, text.length)).toEqual({ line: 3, column: 0 });
  });

  it("maps a position before the row's first pipe to column 0", () => {
    const quoted = source("> | ab | cd |\n> | -- | -- |");
    expect(cellAt(quoted, 1)).toEqual({ line: 0, column: 0 });
    expect(cellAt(quoted, 15)).toEqual({ line: 1, column: 0 });
  });
});
