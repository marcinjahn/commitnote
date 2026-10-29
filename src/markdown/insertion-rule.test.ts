import { describe, expect, it } from "vitest";
import { insertBlock, insertImageReferences } from "./insertion-rule";
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

function table(marked: string, block = "TABLE"): string {
  return run(marked, (text, position) =>
    insertBlock(text, position, block, "table"),
  );
}

describe("insertImageReferences outside tables", () => {
  it.each<[string, string, string]>([
    ["mid-line", "ab¦cd", "ab\nREF\n¦cd"],
    ["at a line end with text after", "ab¦\nnext", "ab\nREF\n¦\nnext"],
    ["at a line end before a blank line", "ab¦\n\nnext", "ab\nREF\n¦\nnext"],
    ["on an empty line", "ab\n¦\ncd", "ab\nREF\n¦\ncd"],
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

  it("places the lines below a blockquote table at its last pipe", () => {
    expect(lines("> | a |\n> | - |\n> | 1 |¦\n# next", "REF")).toBe(
      "> | a |\n> | - |\n> | 1 |\n\nREF\n¦\n# next",
    );
  });

  it("places the lines above a table whose header sits in a blockquote", () => {
    expect(lines("> ¦| a |\n> | - |", "REF")).toBe("REF\n¦\n> | a |\n> | - |");
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

describe("insertBlock with a table", () => {
  it("separates the table from text on both sides after a non-empty line", () => {
    expect(table("ab¦\nnext")).toBe("ab\n\nTABLE\n¦\nnext");
    expect(table("ab¦cd")).toBe("ab\n\nTABLE\n¦\ncd");
  });

  it("separates the table from the paragraph above on a blank line", () => {
    expect(table("one\n¦\ntwo")).toBe("one\n\nTABLE\n¦\ntwo");
  });

  it("separates the table from the paragraph above when the caret ends it", () => {
    expect(table("one¦\n\ntwo")).toBe("one\n\nTABLE\n¦\ntwo");
  });

  it("separates the table from a table above at its last line end", () => {
    expect(table("| a |\n| - |¦\n\nnext")).toBe(
      "| a |\n| - |\n\nTABLE\n¦\nnext",
    );
    expect(table("| a |\n| - |¦")).toBe("| a |\n| - |\n\nTABLE\n¦");
  });

  it("separates the table from a table below at the header line start", () => {
    expect(table("¦| a |\n| - |")).toBe("TABLE\n¦\n| a |\n| - |");
  });

  it("starts an empty document", () => {
    expect(table("¦")).toBe("TABLE\n¦");
  });

  it("keeps a multi-line block intact", () => {
    expect(table("ab¦", "| h |\n| - |")).toBe("ab\n\n| h |\n| - |\n¦");
  });
});
