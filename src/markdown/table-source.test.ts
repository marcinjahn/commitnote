import { describe, expect, it } from "vitest";
import {
  cellAt,
  graphemeLength,
  renderTableGrid,
  tableGrid,
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

function format(text: string, position = 0) {
  return renderTableGrid(tableGrid(source(text, position)));
}

describe("tableSourceAt location", () => {
  const text = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter";
  const from = text.indexOf("| a");
  const to = text.indexOf("\n\nafter");

  it("spans from the header line start to the last line end", () => {
    const table = source(text, from);
    expect([table.from, table.to]).toEqual([from, to]);
  });

  it("finds the table from a position on each line", () => {
    for (const marker of ["a |", "- |", "1 |"]) {
      expect(tableSourceAt(text, text.indexOf(marker))?.from).toBe(from);
    }
  });

  it("includes the header line start and the last line end", () => {
    expect(tableSourceAt(text, from)?.from).toBe(from);
    expect(tableSourceAt(text, to)?.from).toBe(from);
  });

  it("excludes the lines before and after the table", () => {
    expect(tableSourceAt(text, from - 1)).toBeNull();
    expect(tableSourceAt(text, to + 1)).toBeNull();
  });

  it("returns null when header and delimiter cell counts differ", () => {
    expect(tableSourceAt("| a | b |\n| - |\n| 1 | 2 |", 0)).toBeNull();
  });

  it("reads the column count and alignments", () => {
    const table = source("| a | b | c |\n| :- | :-: | -: |");
    expect(table.columnCount).toBe(3);
    expect(table.alignments).toEqual(["left", "center", "right"]);
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
      lead: "",
      leadingPipe: true,
      trailingPipe: true,
    });
    expect(header.cells).toEqual([
      { from: 1, to: 4, contentFrom: 2, contentTo: 3, text: "a" },
      { from: 5, to: 8, contentFrom: 6, contentTo: 7, text: "b" },
    ]);
    expect(texts(table.lines[2])).toEqual(["1", "2"]);
  });

  it("reads segments of rows without leading and trailing pipes", () => {
    const table = source("a | b\n-- | --\n1 | 2");
    const header = table.lines[0];
    expect(header.leadingPipe).toBe(false);
    expect(header.trailingPipe).toBe(false);
    expect(header.cells).toEqual([
      { from: 0, to: 2, contentFrom: 0, contentTo: 1, text: "a" },
      { from: 3, to: 5, contentFrom: 4, contentTo: 5, text: "b" },
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
      leadingPipe: true,
      trailingPipe: true,
    });
    expect(delimiter.cells).toEqual([
      { from: 11, to: 15, contentFrom: 12, contentTo: 14, text: ":-" },
      { from: 16, to: 20, contentFrom: 17, contentTo: 19, text: "-:" },
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
      contentFrom: start,
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
    expect(table.lines.map((line) => line.lead)).toEqual(leads);
    for (const line of table.lines) {
      expect(line.rowFrom).toBe(line.from + line.lead.length);
      expect(line.cells[0].text).not.toBe("");
    }
  });
});

describe("cellAt", () => {
  const text = "| ab | cd |\n| -- | -- |\n| 1 | 2 | xyz |\n|";
  const table = source(text);

  it.each<[number, number, number]>([
    [0, 0, 0],
    [1, 0, 0],
    [3, 0, 1],
    [4, 0, 2],
    [5, 0, 2],
    [6, 1, 0],
    [8, 1, 1],
    [10, 1, 2],
    [11, 1, 2],
  ])(
    "maps header position %i to column %i offset %i",
    (position, column, offset) => {
      expect(cellAt(table, position)).toEqual({ line: 0, column, offset });
    },
  );

  it("maps a delimiter line position to its line and column", () => {
    expect(cellAt(table, text.indexOf("-- |", 15))).toEqual({
      line: 1,
      column: 1,
      offset: 0,
    });
  });

  it("maps an extra cell to the last regular column, clamping the offset", () => {
    expect(cellAt(table, text.indexOf("yz"))).toEqual({
      line: 2,
      column: 1,
      offset: 1,
    });
  });

  it("gives offset 0 when the row lacks the column", () => {
    expect(cellAt(table, text.length)).toEqual({
      line: 3,
      column: 0,
      offset: 0,
    });
  });

  it("maps a position in the lead to column 0", () => {
    const quoted = source("> | ab | cd |\n> | -- | -- |");
    expect(cellAt(quoted, 1)).toEqual({ line: 0, column: 0, offset: 0 });
    expect(cellAt(quoted, 15)).toEqual({ line: 1, column: 0, offset: 0 });
  });
});

describe("graphemeLength", () => {
  it.each<[string, number]>([
    ["👍🏽", 1],
    ["é", 1],
    ["漢", 1],
    ["plain", 5],
    ["", 0],
  ])("counts %j as %i", (text, length) => {
    expect(graphemeLength(text)).toBe(length);
  });
});

describe("table formatting", () => {
  it("pads mixed widths to at least three", () => {
    expect(
      format("| Name | Qty |\n|-|-|\n| apple | 10 |\n| fig | 2 |").text,
    ).toBe(
      "| Name  | Qty |\n| ----- | --- |\n| apple | 10  |\n| fig   | 2   |",
    );
  });

  it("renders all four alignments", () => {
    expect(format("|a|b|c|d|\n|:-|:-:|-:|-|\n|1|2|3|4|").text).toBe(
      "| a   | b   | c   | d   |\n| :-- | :-: | --: | --- |\n| 1   | 2   | 3   | 4   |",
    );
    expect(format("left|center|right|none\n:-|:-:|-:|-").text).toBe(
      "| left | center | right | none |\n| :--- | :----: | ----: | ---- |",
    );
  });

  it("pads short rows with empty cells", () => {
    expect(format("| a | b | c |\n| - | - | - |\n| 1 |").text).toBe(
      "| a   | b   | c   |\n| --- | --- | --- |\n| 1   |     |     |",
    );
  });

  it("keeps extra cells unpadded and drops trailing empty ones", () => {
    expect(
      format("| a | b |\n| - | - |\n| 1 | 2 | xyzw |  |\n| 3 | 4 |  | y |")
        .text,
    ).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   | xyzw |\n| 3   | 4   |  | y |",
    );
  });

  it("keeps each line's lead", () => {
    expect(format("> a | b\n> -|-\n> 1 | 2").text).toBe(
      "> | a   | b   |\n> | --- | --- |\n> | 1   | 2   |",
    );
    expect(format("> | a | b |\n> | - | - |\n| 1 | 2 |").text).toBe(
      "> | a   | b   |\n> | --- | --- |\n| 1   | 2   |",
    );
  });

  it("keeps escaped pipes byte for byte", () => {
    expect(format("| a | b |\n| - | - |\n| x \\| y | `c\\|d` |").text).toBe(
      "| a      | b      |\n| ------ | ------ |\n| x \\| y | `c\\|d` |",
    );
  });

  it("pads by grapheme clusters", () => {
    expect(format("| 👍🏽 | é |\n|-|-|").text).toBe(
      "| 👍🏽   | é   |\n| --- | --- |",
    );
  });

  it.each([
    "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    "| a   | b   | c   | d   |\n| :-- | :-: | --: | --- |\n| 1   | 2   | 3   | 4   |",
    "> | a   | b   |\n> | --- | --- |\n> | 1   | 2   | x |",
    "  | 👍🏽   | x \\| y |\n  | --- | ------ |\n  |     |        |",
  ])("renders a formatted table unchanged: %j", (text) => {
    expect(format(text).text).toBe(text);
  });

  it("reports the start of every regular cell", () => {
    expect(format("| a | b |\n| - | - |\n| 1 | 2 | x |").cellStarts).toEqual([
      [2, 8],
      [16, 22],
      [30, 36],
    ]);
  });

  it("reports cell starts in UTF-16 offsets after leads", () => {
    const { text, cellStarts } = format("> | 👍🏽 | b |\n> | - | - |");
    expect(cellStarts).toEqual([
      [4, 13],
      [text.indexOf("---"), text.lastIndexOf("---")],
    ]);
    expect(text.slice(cellStarts[0][1], cellStarts[0][1] + 1)).toBe("b");
  });
});
