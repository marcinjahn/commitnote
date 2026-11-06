import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { insertImageReferences } from "./insertion-rule";
import { markdownParser } from "./markdown-parser";
import { tableSourceAt } from "./table-source";
import { applyTextEdit, type TextEdit } from "./text-edit";

const MARK = "¦";

function withMarker(text: string, position: number): string {
  return text.slice(0, position) + MARK + text.slice(position);
}

function run(
  marked: string,
  apply: (text: string, position: number) => TextEdit,
): string {
  const position = marked.indexOf(MARK);
  const text = marked.replace(MARK, "");
  const edit = apply(text, position);
  expect(edit.changes).toHaveLength(1);
  expect(edit.selection.anchor).toBe(edit.selection.head);
  return withMarker(applyTextEdit(text, edit), edit.selection.anchor);
}

function lines(marked: string, ...references: string[]): string {
  return run(marked, (text, position) =>
    insertImageReferences(text, position, references),
  );
}

describe("insertImageReferences outside tables", () => {
  it.each<[string, string, string]>([
    ["mid-line", "ab¦cd", "ab\nREF\n¦cd"],
    ["at a line end with text after", "ab¦\nnext", "ab\nREF\n¦\nnext"],
    ["at a line end before a blank line", "ab¦\n\nnext", "ab\nREF\n¦\nnext"],
    ["on an empty line", "ab\n¦\ncd", "ab\nREF\n¦\ncd"],
    ["on an empty first line", "¦\ncd", "REF\n¦\ncd"],
    ["at a line start", "ab\n¦cd", "ab\nREF\n¦cd"],
    ["at the end without a trailing newline", "ab¦", "ab\nREF\n¦"],
    ["at the end with a trailing newline", "ab\n¦", "ab\nREF\n¦"],
    ["at the end before a trailing newline", "ab¦\n", "ab\nREF\n¦"],
    ["in an empty document", "¦", "REF\n¦"],
  ])("%s", (_name, input, expected) => {
    expect(lines(input, "REF")).toBe(expected);
  });

  it("puts several references on their own lines", () => {
    expect(lines("ab¦cd", "ONE", "TWO", "THREE")).toBe(
      "ab\nONE\nTWO\nTHREE\n¦cd",
    );
  });

  it("clamps the position into the text", () => {
    const edit = insertImageReferences("ab", 99, ["REF"]);
    expect(applyTextEdit("ab", edit)).toBe("ab\nREF\n");
    expect(insertImageReferences("ab", -5, ["REF"]).changes[0].from).toBe(0);
  });

  it("measures offsets in UTF-16 code units", () => {
    expect(lines("😀¦x", "REF")).toBe("😀\nREF\n¦x");
  });
});

describe("insertImageReferences around tables", () => {
  const body = "| a |\n| - |\n| 1 |";

  it("separates the lines from a table directly above", () => {
    expect(lines(`${body}\n¦`, "REF")).toBe(`${body}\n\nREF\n¦`);
  });

  it("treats the position after the last trailing pipe as after the table", () => {
    expect(lines("| a |\n| - |\n| 1 |¦\n# next", "REF")).toBe(
      "| a |\n| - |\n| 1 |\n\nREF\n¦\n# next",
    );
  });

  it("reuses the blank line after a table", () => {
    expect(lines("| a |\n| - |\n| 1 |¦\n\nnext", "REF")).toBe(
      "| a |\n| - |\n| 1 |\n\nREF\n¦\nnext",
    );
    expect(lines("| a |\n| - |¦\n\nnext", "REF")).toBe(
      "| a |\n| - |\n\nREF\n¦\nnext",
    );
  });

  it("treats the position after pipe and trailing spaces as after the table", () => {
    expect(lines("| a |\n| - |\n| 1 |  ¦", "REF")).toBe(
      "| a |\n| - |\n| 1 |  \n\nREF\n¦",
    );
  });

  it("separates the lines from a table directly below", () => {
    expect(lines(`¦${body}`, "REF")).toBe(`REF\n¦\n${body}`);
    expect(lines(`intro\n¦${body}`, "REF")).toBe(`intro\nREF\n¦\n${body}`);
  });

  it("places the lines before the table from the header line start region", () => {
    expect(lines("intro\n\n¦| a |\n| - |", "REF")).toBe(
      "intro\n\nREF\n¦\n| a |\n| - |",
    );
  });

  it("places the lines above a table when the caret is at the header line end of a paragraph", () => {
    expect(lines("para¦\n| a |\n| - |", "REF")).toBe(
      "para\nREF\n¦\n| a |\n| - |",
    );
  });

  it("uses the blank line between a paragraph and a table", () => {
    expect(lines("para\n¦\n| a |\n| - |", "REF")).toBe(
      "para\nREF\n¦\n| a |\n| - |",
    );
  });

  it("uses the blank line after a paragraph when the caret ends the paragraph", () => {
    expect(lines("para¦\n\n| a |\n| - |", "REF")).toBe(
      "para\nREF\n¦\n| a |\n| - |",
    );
  });

  it("places the lines above a table whose header sits in a blockquote", () => {
    expect(lines("> ¦| a |\n> | - |", "REF")).toBe(
      "> REF\n>¦\n> | a |\n> | - |",
    );
  });
});

describe("insertImageReferences after a nested table", () => {
  it.each<[string, string, string]>([
    [
      "an ordered list item before the next item",
      "1. x\n\n   | a |\n   | - |\n   | 1 |¦\n2. y",
      "1. x\n\n   | a |\n   | - |\n   | 1 |\n\n   REF\n¦\n2. y",
    ],
    [
      "a blockquote before a heading outside it",
      "> | a |\n> | - |\n> | 1 |¦\n# next",
      "> | a |\n> | - |\n> | 1 |\n>\n> REF\n¦\n# next",
    ],
    [
      "a list item row with no cells at the document end",
      "- item\n\n  | a |\n  | - |\n  |¦",
      "- item\n\n  | a |\n  | - |\n  |\n\n  REF\n¦",
    ],
    [
      "a blockquote before a quoted separator line",
      "> | a |\n> | - |\n> | 1 |¦\n>\n> after",
      "> | a |\n> | - |\n> | 1 |\n>\n> REF\n>¦\n> after",
    ],
    [
      "a list item before a blank line",
      "- x\n\n  | a |\n  | - |\n  | 1 |¦\n\n  more",
      "- x\n\n  | a |\n  | - |\n  | 1 |\n\n  REF\n¦\n  more",
    ],
    [
      "a blockquote before a quoted heading",
      "> | a |\n> | - |\n> | 1 |¦\n> # head",
      "> | a |\n> | - |\n> | 1 |\n>\n> REF\n>¦\n> # head",
    ],
    [
      "a blockquote before a blank line and a paragraph",
      "> | a |\n> | - |\n> | 1 |¦\n\nnext",
      "> | a |\n> | - |\n> | 1 |\n>\n> REF\n¦\nnext",
    ],
    [
      "a two-level blockquote at the document end",
      "> > | a |\n> > | - |\n> > | 1 |¦",
      "> > | a |\n> > | - |\n> > | 1 |\n> >\n> > REF\n¦",
    ],
    [
      "a two-level blockquote before a one-level quoted heading",
      "> > | a |\n> > | - |\n> > | 1 |¦\n> # head",
      "> > | a |\n> > | - |\n> > | 1 |\n> >\n> > REF\n>¦\n> # head",
    ],
    [
      "a blockquote before a trailing newline",
      "> | a |\n> | - |\n> | 1 |¦\n",
      "> | a |\n> | - |\n> | 1 |\n>\n> REF\n¦",
    ],
  ])("keeps the references in the container of %s", (_name, marked, out) => {
    expect(lines(marked, "REF")).toBe(out);
  });

  it("prefixes every reference line", () => {
    expect(lines("> | a |\n> | - |\n> | 1 |¦\n# next", "A", "B")).toBe(
      "> | a |\n> | - |\n> | 1 |\n>\n> A\n> B\n¦\n# next",
    );
  });

  function ancestor(node: SyntaxNode): SyntaxNode | null {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.name === "ListItem" || parent.name === "Blockquote") {
        return parent;
      }
    }
    return null;
  }

  function structure(text: string): {
    tableContainer: SyntaxNode | null;
    imageContainer: SyntaxNode | null;
    containers: number;
  } {
    const root = markdownParser.parse(text).topNode;
    let tableNode: SyntaxNode | null = null;
    let imageNode: SyntaxNode | null = null;
    const cursor = root.cursor();
    do {
      if (cursor.name === "Table" && !tableNode) tableNode = cursor.node;
      if (cursor.name === "Image" && !imageNode) imageNode = cursor.node;
    } while (cursor.next());
    let containers = 0;
    for (let child = root.firstChild; child; child = child.nextSibling) {
      if (["BulletList", "OrderedList", "Blockquote"].includes(child.name)) {
        containers++;
      }
    }
    return {
      tableContainer: tableNode && ancestor(tableNode),
      imageContainer: imageNode && ancestor(imageNode),
      containers,
    };
  }

  const tables: [string, string][] = [
    ["a list item", "- x\n\n  | a |\n  | - |\n  | 1 |"],
    ["an ordered list item", "1. x\n\n   | a |\n   | - |\n   | 1 |"],
    ["a blockquote", "> | a |\n> | - |\n> | 1 |"],
    ["a two-level blockquote", "> > | a |\n> > | - |\n> > | 1 |"],
    [
      "a list item with no cells in the last row",
      "- x\n\n  | a |\n  | - |\n  |",
    ],
    ["a blockquote with no cells in the last row", "> | a |\n> | - |\n> |"],
  ];
  const followers: Record<string, string[]> = {
    "a list item": ["", "\n- y", "\n\n  more", "\n\nnext"],
    "an ordered list item": ["", "\n2. y", "\n\n   more", "\n\nnext"],
    "a blockquote": ["", "\n>\n> after", "\n> # head", "\n\nnext", "\n# next"],
    "a two-level blockquote": ["", "\n> > # head", "\n>\n> after", "\n\nnext"],
  };

  it.each(tables)(
    "keeps the table and the image together in %s",
    (name, base) => {
      const key = name.replace(" with no cells in the last row", "");
      for (const follower of followers[key]) {
        const text = base + follower;
        const original = tableSourceAt(text, text.indexOf("|"));
        expect(original?.prefix).toBeTruthy();
        const last = original!.lines[original!.lines.length - 1];
        const start =
          last.cells.length === 0
            ? text.indexOf("|", last.rowFrom) + 1
            : last.cells[last.cells.length - 1].to + 1;
        const rowsOf = (found: NonNullable<typeof original>, source: string) =>
          found.lines.map((line) => source.slice(line.from, line.to));
        const before = structure(text).containers;
        for (let position = start; position <= last.to; position++) {
          const result = applyTextEdit(
            text,
            insertImageReferences(text, position, ["![](a.webp)"]),
          );
          const found = tableSourceAt(result, result.indexOf("|"));
          expect(found?.prefix).toBe(original!.prefix);
          expect(rowsOf(found!, result)).toEqual(rowsOf(original!, text));
          const parsed = structure(result);
          expect(parsed.imageContainer).not.toBeNull();
          expect(parsed.imageContainer!.name).toBe(parsed.tableContainer!.name);
          expect(parsed.imageContainer!.from).toBe(parsed.tableContainer!.from);
          expect(parsed.imageContainer!.to).toBe(parsed.tableContainer!.to);
          expect(parsed.containers).toBe(before);
        }
      }
    },
  );
});

describe("insertImageReferences before a nested table", () => {
  it.each<[string, string, string[], string]>([
    [
      "a list item at the header start",
      "- x\n\n  ¦| a |\n  | - |",
      ["REF"],
      "- x\n\n  REF\n¦\n  | a |\n  | - |",
    ],
    [
      "a list item at the header line start",
      "- x\n\n¦  | a |\n  | - |",
      ["REF"],
      "- x\n\n  REF\n¦\n  | a |\n  | - |",
    ],
    [
      "a blockquote at the header start",
      "> ¦| a |\n> | - |",
      ["REF"],
      "> REF\n>¦\n> | a |\n> | - |",
    ],
    [
      "a blockquote at the header line start",
      "¦> | a |\n> | - |",
      ["REF"],
      "> REF\n>¦\n> | a |\n> | - |",
    ],
    [
      "an ordered list item",
      "1. x\n\n   ¦| a |\n   | - |",
      ["REF"],
      "1. x\n\n   REF\n¦\n   | a |\n   | - |",
    ],
    [
      "a two-level blockquote",
      "> > ¦| a |\n> > | - |",
      ["REF"],
      "> > REF\n> >¦\n> > | a |\n> > | - |",
    ],
    [
      "several references",
      "> ¦| a |\n> | - |",
      ["A", "B"],
      "> A\n> B\n>¦\n> | a |\n> | - |",
    ],
    [
      "a blockquote with a paragraph above",
      "> intro\n>\n> ¦| a |\n> | - |",
      ["REF"],
      "> intro\n>\n> REF\n>¦\n> | a |\n> | - |",
    ],
    [
      "a list item followed by another item",
      "- x\n\n  ¦| a | b |\n  | - | - |\n  | 1 | 2 |\n- y",
      ["REF"],
      "- x\n\n  REF\n¦\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n- y",
    ],
  ])(
    "keeps the references in the container of %s",
    (_name, marked, refs, out) => {
      expect(lines(marked, ...refs)).toBe(out);
    },
  );

  it.each<[string, string]>([
    ["a list item", "- x\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n- y"],
    ["an ordered list item", "1. x\n\n   | a |\n   | - |\n   | 1 |\n2. y"],
    ["a blockquote", "> | a |\n> | - |\n> | 1 |"],
    ["a two-level blockquote", "> > | a |\n> > | - |\n> > | 1 |"],
  ])("keeps the prefix and rows of the table in %s", (_name, text) => {
    const original = tableSourceAt(text, text.indexOf("|"));
    expect(original?.prefix).toBeTruthy();
    const header = original!.lines[0];
    const rows = (table: NonNullable<typeof original>, source: string) =>
      table.lines.map((line) => source.slice(line.from, line.to));
    for (let position = header.from; position <= header.rowFrom; position++) {
      const edit = insertImageReferences(text, position, ["REF"]);
      const result = applyTextEdit(text, edit);
      const found = tableSourceAt(result, result.indexOf("| a"));
      expect(found?.prefix).toBe(original!.prefix);
      expect(rows(found!, result)).toEqual(rows(original!, text));
    }
  });

  it.each<[string, string, string]>([
    [
      "a top-level table",
      "intro\n\n¦| a |\n| - |",
      "intro\n\nREF\n¦\n| a |\n| - |",
    ],
    [
      "an irregular nested table at the start",
      "¦> | a | b |\n> | - | - |\n| 1 | 2 |",
      "REF\n¦\n> | a | b |\n> | - | - |\n| 1 | 2 |",
    ],
    [
      "an irregular nested table after the prefix",
      "> ¦| a | b |\n> | - | - |\n| 1 | 2 |",
      "REF\n¦\n> | a | b |\n> | - | - |\n| 1 | 2 |",
    ],
  ])("keeps the output for %s", (_name, marked, out) => {
    expect(lines(marked, "REF")).toBe(out);
  });
});

describe("insertImageReferences in cells", () => {
  const rows = "| a |\n| - |\n";

  it.each<[string, string, string]>([
    ["mid content", "| a¦b |\n| - |", "| a REF¦ b |\n| - |"],
    ["content start", "| ¦ab |\n| - |", "| REF¦ ab |\n| - |"],
    ["content end", "| ab¦ |\n| - |", "| ab REF¦ |\n| - |"],
    ["a cell without padding", "|a¦b|\n|-|", "|a REF¦ b|\n|-|"],
    ["a body cell", `${rows}| x¦y |`, `${rows}| x REF¦ y |`],
    [
      "a cell without a leading pipe",
      "a¦b | c\n-- | --",
      "a REF¦ b | c\n-- | --",
    ],
    ["an empty cell with spaces", `${rows}| ¦ |`, `${rows}| REF¦ |`],
    ["an empty cell without spaces", `${rows}|¦|`, `${rows}| REF¦ |`],
    ["an empty cell after its padding", `${rows}|  ¦|`, `${rows}|  REF¦ |`],
    [
      "an extra cell",
      "| a |\n| - |\n| 1 | x¦y |",
      "| a |\n| - |\n| 1 | x REF¦ y |",
    ],
  ])("%s", (_name, input, expected) => {
    expect(lines(input, "REF")).toBe(expected);
  });

  it("clamps a position in the line lead into the first cell", () => {
    expect(lines("| a |\n| - |\n  ¦| x |", "REF")).toBe(
      "| a |\n| - |\n  | REF¦ x |",
    );
    expect(lines("> | a |\n> | - |\n> ¦| x |", "REF")).toBe(
      "> | a |\n> | - |\n> | REF¦ x |",
    );
  });

  it("joins several references with spaces", () => {
    expect(lines("| a¦b |\n| - |", "ONE", "TWO")).toBe(
      "| a ONE TWO¦ b |\n| - |",
    );
  });

  it("does not add spaces next to existing whitespace", () => {
    expect(lines("| a ¦ b |\n| - |", "REF")).toBe("| a REF¦ b |\n| - |");
  });

  it("clamps a position past a row without a trailing pipe into its last cell", () => {
    expect(lines("| a |\n| - |\n| 1 | x¦", "REF")).toBe(
      "| a |\n| - |\n| 1 | x REF¦",
    );
  });

  describe("on the delimiter line", () => {
    it("inserts at the end of the header cell content", () => {
      expect(lines("| ab | cd |\n| -¦- | -- |", "REF")).toBe(
        "| ab REF¦ | cd |\n| -- | -- |",
      );
      expect(lines("| ab | cd |\n| -- | -¦- |", "REF")).toBe(
        "| ab | cd REF¦ |\n| -- | -- |",
      );
    });

    it("inserts at the start of an empty header cell", () => {
      expect(lines("|  | cd |\n| -¦- | -- |", "REF")).toBe(
        "| REF¦ | cd |\n| -- | -- |",
      );
      expect(lines("|| cd |\n|¦-- | -- |", "REF")).toBe(
        "| REF¦ | cd |\n|-- | -- |",
      );
    });

    it("places the lines after a table that ends with the delimiter line", () => {
      expect(lines("| ab |\n| -- |¦", "REF")).toBe("| ab |\n| -- |\n\nREF\n¦");
    });
  });

  it("inserts into a blockquote table cell", () => {
    expect(lines("> | a |\n> | - |\n> | x¦y |", "REF")).toBe(
      "> | a |\n> | - |\n> | x REF¦ y |",
    );
  });

  it("inserts into a list item table cell", () => {
    expect(lines("- item\n\n  | a |\n  | - |\n  | x¦y |", "REF")).toBe(
      "- item\n\n  | a |\n  | - |\n  | x REF¦ y |",
    );
  });

  it("inserts into an irregular nested table cell", () => {
    expect(lines("> | a | b |\n> | - | - |\n| 1 | x¦y |", "REF")).toBe(
      "> | a | b |\n> | - | - |\n| 1 | x REF¦ y |",
    );
  });

  it("inserts a real image reference unchanged", () => {
    const reference = "![](image:01ARZ3NDEKTSV4RRFFQ69G5FAV#640x480)";
    expect(lines("| a¦b |\n| - |", reference)).toBe(
      `| a ${reference}¦ b |\n| - |`,
    );
  });
});

describe("insertImageReferences on rows with no cells", () => {
  it.each<[string, string, string]>([
    [
      "before the pipe of the last row",
      "| a | b |\n| - | - |\n¦|",
      "| a | b |\n| - | - |\nREF¦ |",
    ],
    [
      "after the pipe of the last row",
      "| a | b |\n| - | - |\n|¦",
      "| a | b |\n| - | - |\n|\n\nREF\n¦",
    ],
    [
      "after the pipe and space of the last row",
      "| a | b |\n| - | - |\n| ¦",
      "| a | b |\n| - | - |\n| \n\nREF\n¦",
    ],
    [
      "after the pipe of a row in the middle",
      "| a | b |\n| - | - |\n|¦\n| c | d |",
      "| a | b |\n| - | - |\n| REF¦\n| c | d |",
    ],
    [
      "inside the container prefix of a blockquote row",
      "> | a |\n> | - |\n¦> |\n",
      "> | a |\n> | - |\n> REF¦ |\n",
    ],
    [
      "after the pipe of a blockquote last row",
      "> | a |\n> | - |\n> |¦\n",
      "> | a |\n> | - |\n> |\n>\n> REF\n¦",
    ],
    [
      "before the pipe of a list item row",
      "- item\n\n  | a |\n  | - |\n  ¦|",
      "- item\n\n  | a |\n  | - |\n  REF¦ |",
    ],
    [
      "after the pipe of a list item last row",
      "- item\n\n  | a |\n  | - |\n  |¦",
      "- item\n\n  | a |\n  | - |\n  |\n\n  REF\n¦",
    ],
  ])("%s", (_name, input, expected) => {
    expect(lines(input, "REF")).toBe(expected);
  });

  const NO_CELL_ROW = /^(?:>\s*|\s+)?\|\s*$/;
  const sweepTexts: [string, string][] = [
    ["top level last row", "| a | b |\n| - | - |\n|"],
    ["top level last row with a space", "| a | b |\n| - | - |\n| "],
    ["top level middle row", "| a | b |\n| - | - |\n|\n| c | d |"],
    ["blockquote last row", "> | a |\n> | - |\n> |\n"],
    ["blockquote middle row", "> | a |\n> | - |\n> |\n> | c |\n"],
    ["list item last row", "- item\n\n  | a |\n  | - |\n  |"],
    ["list item middle row", "- item\n\n  | a |\n  | - |\n  |\n  | c |"],
  ];

  it.each(sweepTexts)(
    "places references at every position of a %s",
    (_name, text) => {
      const rows = text.split("\n");
      const lastRow = rows.findLastIndex((row) => row.includes("|"));
      let rowFrom = 0;
      const spans = rows.map((row, index) => {
        const span = {
          from: rowFrom,
          to: rowFrom + row.length,
          index,
          bare: NO_CELL_ROW.test(row),
          pipe: rowFrom + row.indexOf("|"),
        };
        rowFrom += row.length + 1;
        return span;
      });

      for (let position = 0; position <= text.length; position++) {
        const edit = insertImageReferences(text, position, ["REF"]);
        expect(edit.changes).toHaveLength(1);
        const [change] = edit.changes;
        const row = spans.find(
          (span) => span.bare && span.from <= position && position <= span.to,
        );
        if (!row) continue;
        if (row.index === lastRow && position > row.pipe) {
          expect(change.from).toBeGreaterThanOrEqual(row.to);
          expect(change.insert).toContain("REF");
        } else {
          const point = Math.min(Math.max(position, row.pipe), row.to);
          expect(change.from).toBe(point);
          expect(change.insert.trim()).toBe("REF");
        }
      }
    },
  );
});
