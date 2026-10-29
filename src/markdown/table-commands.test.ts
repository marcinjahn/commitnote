import { describe, expect, it } from "vitest";
import {
  TABLE_COMMANDS,
  applyTableCommand,
  availableTableCommands,
  tableCommandAvailability,
  type ColumnAlignment,
  type TableCommand,
} from "./table-commands";
import { applyTextEdit, type TextSelection } from "./text-edit";

const CARET = "¦";
const ANCHOR = "«";
const HEAD = "»";

function parse(marked: string): { text: string; selection: TextSelection } {
  const caret = marked.indexOf(CARET);
  if (caret >= 0) {
    return {
      text: marked.replace(CARET, ""),
      selection: { anchor: caret, head: caret },
    };
  }
  const anchor = marked.indexOf(ANCHOR);
  const head = marked.indexOf(HEAD);
  if (anchor < 0 || head < 0) throw new Error("no selection marker");
  return {
    text: marked.replace(ANCHOR, "").replace(HEAD, ""),
    selection: {
      anchor: anchor < head ? anchor : anchor - 1,
      head: head < anchor ? head : head - 1,
    },
  };
}

function show(text: string, { anchor, head }: TextSelection): string {
  if (anchor === head) return text.slice(0, head) + CARET + text.slice(head);
  const marks = [
    { at: anchor, mark: ANCHOR },
    { at: head, mark: HEAD },
  ].sort((a, b) => b.at - a.at);
  let result = text;
  for (const { at, mark } of marks) {
    result = result.slice(0, at) + mark + result.slice(at);
  }
  return result;
}

function run(
  marked: string,
  command: TableCommand,
  argument?: ColumnAlignment,
): string | null {
  const { text, selection } = parse(marked);
  const edit = applyTableCommand(text, selection, command, argument);
  if (!edit) return null;
  expect(edit.changes.length).toBeLessThanOrEqual(1);
  return show(applyTextEdit(text, edit), edit.selection);
}

const NEW_TABLE = [
  "| «Column 1» | Column 2 | Column 3 |",
  "| -------- | -------- | -------- |",
  "|          |          |          |",
  "|          |          |          |",
].join("\n");

describe("table commands inside containers", () => {
  const containers: [string, string, string][] = [
    ["top level", "", ""],
    ["blockquote", "> ", ""],
    ["two-level blockquote", "> > ", ""],
    ["list item", "  ", "- item\n\n"],
  ];

  const cases: [
    string,
    TableCommand,
    ColumnAlignment | undefined,
    string[],
    string[],
  ][] = [
    [
      "insert row above",
      "insert-row-above",
      undefined,
      ["| a | b |", "| - | :-: |", "| 1¦ | 2 |", "| 3 | 4 |"],
      [
        "| a   | b   |",
        "| --- | :-: |",
        "| ¦    |     |",
        "| 1   | 2   |",
        "| 3   | 4   |",
      ],
    ],
    [
      "insert row below",
      "insert-row-below",
      undefined,
      ["| a | b |", "| - | :-: |", "| 1 | 2 |", "| 3 | 4¦ |"],
      [
        "| a   | b   |",
        "| --- | :-: |",
        "| 1   | 2   |",
        "| 3   | 4   |",
        "|     | ¦    |",
      ],
    ],
    [
      "insert column left",
      "insert-column-left",
      undefined,
      ["| a | b¦ |", "| - | :-: |", "| 1 | 2 |", "| 3 | 4 |"],
      [
        "| a   | ¦    | b   |",
        "| --- | --- | :-: |",
        "| 1   |     | 2   |",
        "| 3   |     | 4   |",
      ],
    ],
    [
      "insert column right",
      "insert-column-right",
      undefined,
      ["| a | b |", "| - | :-: |", "| 1 | ¦2 |", "| 3 | 4 |"],
      [
        "| a   | b   |     |",
        "| --- | :-: | --- |",
        "| 1   | 2   | ¦    |",
        "| 3   | 4   |     |",
      ],
    ],
    [
      "delete row",
      "delete-row",
      undefined,
      ["| a | b |", "| - | :-: |", "| 1 | 2¦ |", "| 3 | 4 |"],
      ["| a   | b   |", "| --- | :-: |", "| 3   | ¦4   |"],
    ],
    [
      "delete column",
      "delete-column",
      undefined,
      ["| a¦ | b |", "| - | :-: |", "| 1 | 2 |", "| 3 | 4 |"],
      ["| ¦b   |", "| :-: |", "| 2   |", "| 4   |"],
    ],
    [
      "align column",
      "align-column",
      "right",
      ["| a | b |", "| - | :-: |", "| 1 | 2 |", "| 3 | 4¦ |"],
      ["| a   | b   |", "| --- | --: |", "| 1   | 2   |", "| 3   | 4¦   |"],
    ],
    [
      "format table",
      "format-table",
      undefined,
      ["| a | b |", "| - | :-: |", "| 1¦ | 2 |", "| 3 | 4 |"],
      ["| a   | b   |", "| --- | :-: |", "| 1¦   | 2   |", "| 3   | 4   |"],
    ],
    [
      "next cell",
      "next-cell",
      undefined,
      ["| a | b |", "| - | :-: |", "| ¦1 | 2 |", "| 3 | 4 |"],
      ["| a   | b   |", "| --- | :-: |", "| 1   | «2»   |", "| 3   | 4   |"],
    ],
    [
      "previous cell",
      "previous-cell",
      undefined,
      ["| a | b |", "| - | :-: |", "| 1 | 2 |", "| 3 | ¦4 |"],
      ["| a   | b   |", "| --- | :-: |", "| 1   | 2   |", "| «3»   | 4   |"],
    ],
  ];

  describe.each(containers)("%s", (_name, lead, before) => {
    const nest = (lines: string[]) =>
      before + lines.map((line) => lead + line).join("\n");

    it.each(cases)("%s", (_case, command, argument, input, expected) => {
      expect(run(nest(input), command, argument)).toBe(nest(expected));
    });

    it("insert table goes after the table, at the top level", () => {
      const input = ["| a | b |", "| - | :-: |", "| 1¦ | 2 |"];
      const kept = ["| a | b |", "| - | :-: |", "| 1 | 2 |"];
      expect(run(nest(input), "insert-table")).toBe(
        nest(kept) + "\n\n" + NEW_TABLE + "\n",
      );
    });
  });
});

describe("insert table", () => {
  it.each<[string, string, string]>([
    ["on a blank line", "ab\n¦\ncd", "ab\n\n" + NEW_TABLE + "\n\ncd"],
    ["after a non-empty line", "a¦b\ncd", "ab\n\n" + NEW_TABLE + "\n\ncd"],
    [
      "inside a table",
      "| a |\n| - |\n| ¦1 |\n\nnext",
      "| a |\n| - |\n| 1 |\n\n" + NEW_TABLE + "\n\nnext",
    ],
    [
      "inside an irregular nested table",
      "> | a | b |\n> | - | - |\n| 1¦ | 2 |",
      "> | a | b |\n> | - | - |\n| 1 | 2 |\n\n" + NEW_TABLE + "\n",
    ],
    ["at the document end", "ab¦", "ab\n\n" + NEW_TABLE + "\n"],
    ["in an empty document", "¦", NEW_TABLE + "\n"],
  ])("%s", (_name, input, expected) => {
    expect(run(input, "insert-table")).toBe(expected);
  });

  it("inserts the exact block and selects Column 1", () => {
    const edit = applyTableCommand("", { anchor: 0, head: 0 }, "insert-table");
    expect(edit).toEqual({
      changes: [
        {
          from: 0,
          to: 0,
          insert:
            "| Column 1 | Column 2 | Column 3 |\n" +
            "| -------- | -------- | -------- |\n" +
            "|          |          |          |\n" +
            "|          |          |          |\n",
        },
      ],
      selection: { anchor: 2, head: 10 },
    });
  });
});

describe("row commands", () => {
  const table = (rows: string) => "| a | b |\n| - | - |\n" + rows;

  it("inserts a row below the header from the delimiter line", () => {
    expect(
      run(table("| 1 | 2 |").replace("| - |", "| -¦ |"), "insert-row-below"),
    ).toBe("| a   | b   |\n| --- | --- |\n| ¦    |     |\n| 1   | 2   |");
  });

  it("inserts a row below the header", () => {
    expect(run("| a | b¦ |\n| - | - |", "insert-row-below")).toBe(
      "| a   | b   |\n| --- | --- |\n|     | ¦    |",
    );
  });

  it("inserts a row above the first body row", () => {
    expect(run(table("| 1 | 2¦ |"), "insert-row-above")).toBe(
      "| a   | b   |\n| --- | --- |\n|     | ¦    |\n| 1   | 2   |",
    );
  });

  it("is null for insert row above on the header and the delimiter line", () => {
    expect(
      run(table("| 1 | 2 |").replace("a", "a¦"), "insert-row-above"),
    ).toBeNull();
    expect(
      run(table("| 1 | 2 |").replace("| - |", "| -¦ |"), "insert-row-above"),
    ).toBeNull();
  });

  it("deletes the last body row and moves to the previous one", () => {
    expect(run(table("| 1 | 2 |\n| 3 | ¦4 |"), "delete-row")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | ¦2   |",
    );
  });

  it("deletes the only body row and moves to the header", () => {
    expect(run(table("| 1 | ¦2 |"), "delete-row")).toBe(
      "| a   | ¦b   |\n| --- | --- |",
    );
  });

  it("is null for delete row on the header and the delimiter line", () => {
    expect(run(table("| 1 | 2 |").replace("a", "a¦"), "delete-row")).toBeNull();
    expect(
      run(table("| 1 | 2 |").replace("| - |", "| -¦ |"), "delete-row"),
    ).toBeNull();
  });

  it("gives a new row the header line's lead", () => {
    expect(run("  | a |\n  | - |\n  | 1¦ |", "insert-row-below")).toBe(
      "  | a   |\n  | --- |\n  | 1   |\n  | ¦    |",
    );
  });
});

describe("column commands", () => {
  const aligned = "| a | b |\n| :- | -: |\n| 1 | 2 |";

  it("inserts a column at the first position, keeping other alignments", () => {
    expect(run(aligned.replace("1", "¦1"), "insert-column-left")).toBe(
      "|     | a   | b   |\n| --- | :-- | --: |\n| ¦    | 1   | 2   |",
    );
  });

  it("inserts a column at the last position, keeping other alignments", () => {
    expect(run(aligned.replace("b", "b¦"), "insert-column-right")).toBe(
      "| a   | b   | ¦    |\n| :-- | --: | --- |\n| 1   | 2   |     |",
    );
  });

  it("goes to the header for the delimiter line", () => {
    expect(run(aligned.replace(":- |", ":-¦ |"), "insert-column-right")).toBe(
      "| a   | ¦    | b   |\n| :-- | --- | --: |\n| 1   |     | 2   |",
    );
  });

  it("pads short rows first and keeps extra cells after the regular ones", () => {
    expect(
      run(
        "| a | b |\n| - | - |\n| 1 |\n| 2 | 3 | x |\n| ¦4 | 5 |",
        "insert-column-left",
      ),
    ).toBe(
      "|     | a   | b   |\n| --- | --- | --- |\n|     | 1   |     |\n|     | 2   | 3   | x |\n| ¦    | 4   | 5   |",
    );
  });

  it("deletes the last column and moves to the previous one", () => {
    expect(run(aligned.replace("2", "2¦"), "delete-column")).toBe(
      "| a   |\n| :-- |\n| ¦1   |",
    );
  });

  it("deletes a column from the delimiter line and stays on the header", () => {
    expect(run(aligned.replace(":- |", ":-¦ |"), "delete-column")).toBe(
      "| ¦b   |\n| --: |\n| 2   |",
    );
  });

  it("is null for delete column in a one-column table", () => {
    expect(run("| a |\n| - |\n| ¦1 |", "delete-column")).toBeNull();
  });
});

describe("align column", () => {
  const table = "| a | b |\n| - | - |\n| 1 | 2¦ |";

  it.each<[ColumnAlignment, string]>([
    ["left", ":--"],
    ["center", ":-:"],
    ["right", "--:"],
    ["default", "---"],
  ])("aligns %s", (argument, spec) => {
    expect(run(table, "align-column", argument)).toBe(
      `| a   | b   |\n| --- | ${spec} |\n| 1   | 2¦   |`,
    );
  });

  it("resets an alignment to the default", () => {
    expect(run("| a |\n| :-: |\n| ¦1 |", "align-column", "default")).toBe(
      "| a   |\n| --- |\n| ¦1   |",
    );
  });

  it("keeps the caret on the delimiter line", () => {
    expect(run("| a | b |\n| - | -¦ |", "align-column", "center")).toBe(
      "| a   | b   |\n| --- | :¦-: |",
    );
  });

  it("is null for an invalid or missing argument", () => {
    const { text, selection } = parse(table);
    expect(
      applyTableCommand(
        text,
        selection,
        "align-column",
        "middle" as ColumnAlignment,
      ),
    ).toBeNull();
    expect(applyTableCommand(text, selection, "align-column")).toBeNull();
  });
});

describe("format table", () => {
  it("preserves escaped pipes inside and outside code spans", () => {
    expect(
      run("| a | b |\n|-|-|\n| x \\| y¦ | `c\\|d` |", "format-table"),
    ).toBe("| a      | b      |\n| ------ | ------ |\n| x \\| y¦ | `c\\|d` |");
  });

  it("pads a cell with an emoji by graphemes", () => {
    expect(run("| a | b |\n|-|-|\n| 👍🏽¦ | x |", "format-table")).toBe(
      "| a   | b   |\n| --- | --- |\n| 👍🏽¦   | x   |",
    );
  });

  it("gives no change for an already formatted table", () => {
    const { text, selection } = parse(
      "| a   | b   |\n| --- | --- |\n| 1¦   | 2   |",
    );
    expect(applyTableCommand(text, selection, "format-table")).toEqual({
      changes: [],
      selection,
    });
  });

  it("clamps a caret in cell padding to the content end", () => {
    expect(run("| a  ¦  | b |\n|-|-|", "format-table")).toBe(
      "| a¦   | b   |\n| --- | --- |",
    );
  });

  it("clamps a caret on the delimiter line to the new dashes", () => {
    expect(run("| a | b |\n| -----¦----- | - |", "format-table")).toBe(
      "| a   | b   |\n| ---¦ | --- |",
    );
  });

  it("keeps the caret offset in a shorter delimiter cell", () => {
    expect(run("| abcde | b |\n| -¦ | - |", "format-table")).toBe(
      "| abcde | b   |\n| -¦---- | --- |",
    );
  });

  it("maps a caret in an extra cell to the last regular column", () => {
    expect(run("| a | b |\n|-|-|\n| 1 | 2 | x¦y |", "format-table")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2¦   | xy |",
    );
  });
});

describe("next cell", () => {
  it("places a caret in an empty cell", () => {
    expect(run("| a | b |\n| - | - |\n| ¦1 |  |", "next-cell")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | ¦    |",
    );
  });

  it("moves from the last header cell to the first body cell", () => {
    expect(run("| a | b¦ |\n|-|-|\n| 1 | 2 |", "next-cell")).toBe(
      "| a   | b   |\n| --- | --- |\n| «1»   | 2   |",
    );
  });

  it("appends a body row from the last cell", () => {
    expect(run("| a | b |\n|-|-|\n| 1 | 2¦ |", "next-cell")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ¦    |     |",
    );
  });

  it("appends the first body row from the last header cell", () => {
    expect(run("> | a | b¦ |\n> |-|-|", "next-cell")).toBe(
      "> | a   | b   |\n> | --- | --- |\n> | ¦    |     |",
    );
  });

  it("moves from a middle delimiter cell to the header's next column", () => {
    expect(
      run("| a | b | c |\n| - | -¦ | - |\n| 1 | 2 | 3 |", "next-cell"),
    ).toBe("| a   | b   | «c»   |\n| --- | --- | --- |\n| 1   | 2   | 3   |");
  });

  it("moves from the last delimiter cell to the first body cell", () => {
    expect(run("| a | b |\n| - | -¦ |\n| 1 | 2 |", "next-cell")).toBe(
      "| a   | b   |\n| --- | --- |\n| «1»   | 2   |",
    );
  });

  it("moves from an extra cell to the next row", () => {
    expect(
      run("| a | b |\n|-|-|\n| 1 | 2 | x¦y |\n| 3 | 4 |", "next-cell"),
    ).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   | xy |\n| «3»   | 4   |");
  });
});

describe("previous cell", () => {
  it("moves from the first body cell to the last header cell", () => {
    expect(run("| a | b |\n|-|-|\n| ¦1 | 2 |", "previous-cell")).toBe(
      "| a   | «b»   |\n| --- | --- |\n| 1   | 2   |",
    );
  });

  it("moves from the delimiter line at column 1 to the header's column 0", () => {
    expect(run("| a | b |\n| - | -¦ |", "previous-cell")).toBe(
      "| «a»   | b   |\n| --- | --- |",
    );
  });

  it("moves to the last cell of the previous body row", () => {
    expect(run("| a | b |\n|-|-|\n| 1 | 2 |\n| ¦3 | |", "previous-cell")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | «2»   |\n| 3   |     |",
    );
  });

  it.each(["| ¦a | b |\n|-|-|", "| a | b |\n|¦-|-|", "| «a» | b |\n|-|-|"])(
    "changes nothing in the first header cell: %j",
    (marked) => {
      const { text, selection } = parse(marked);
      expect(applyTableCommand(text, selection, "previous-cell")).toEqual({
        changes: [],
        selection,
      });
    },
  );
});

describe("selection head", () => {
  it("acts on the head of a non-collapsed selection", () => {
    const marked = "| a« | b |\n|-|-|\n| 1» | 2 |";
    expect(run(marked, "insert-row-above")).toBe(
      "| a   | b   |\n| --- | --- |\n| ¦    |     |\n| 1   | 2   |",
    );
    expect(run(marked, "next-cell")).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | «2»   |",
    );
  });

  it("acts on a head before the anchor", () => {
    expect(run("| a» | b |\n|-|-|\n| 1« | 2 |", "delete-row")).toBeNull();
  });
});

const OUTSIDE_OR_IRREGULAR: [string, string][] = [
  ["a paragraph", "text¦\n\n| a |\n| - |"],
  ["a blank line before a table", "text\n¦\n| a |\n| - |"],
  ["an irregular nested table", "> | a | b |\n> | - | - |\n| 1¦ | 2 |"],
  [
    "the header of an irregular nested table",
    "> | a¦ | b |\n> | - | - |\n| 1 | 2 |",
  ],
];

describe("outside a regular table", () => {
  const commands = TABLE_COMMANDS.filter(
    (command) => command !== "insert-table",
  );

  it.each(OUTSIDE_OR_IRREGULAR)("%s", (_name, marked) => {
    for (const command of commands) {
      expect(run(marked, command, "left"), command).toBeNull();
    }
  });
});

describe("availability lists", () => {
  const all = [...TABLE_COMMANDS];
  const withoutBodyOnly = all.filter(
    (command) => command !== "insert-row-above" && command !== "delete-row",
  );

  it.each<[string, string, TableCommand[]]>([
    ["outside a table", "text¦\n\n| a | b |\n| - | - |", ["insert-table"]],
    ["header", "| a¦ | b |\n| - | - |\n| 1 | 2 |", withoutBodyOnly],
    ["delimiter line", "| a | b |\n| -¦ | - |\n| 1 | 2 |", withoutBodyOnly],
    ["body", "| a | b |\n| - | - |\n| 1¦ | 2 |", all],
    [
      "one-column body",
      "| a |\n| - |\n| 1¦ |",
      all.filter((command) => command !== "delete-column"),
    ],
    ["nested regular", "> > | a | b |\n> > | - | - |\n> > | 1¦ | 2 |", all],
    [
      "irregular nested",
      "> | a | b |\n> | - | - |\n| 1¦ | 2 |",
      ["insert-table"],
    ],
  ])("%s", (_name, marked, expected) => {
    const { text, selection } = parse(marked);
    expect(availableTableCommands(text, selection)).toEqual(expected);
  });
});

describe("availability invariant", () => {
  it.each([
    "intro\n\n| a | b |\n| :- | -: |\n| 1 | 2 | x |\n| 3 |\n|\n\nafter",
    "| a |\n| - |",
    "> | a | b |\n> | - | - |\n> | 1 | 2 |\n\n- item\n\n  | c | d |\n  | - | - |\n  | 3 | 4 |",
    "> > | a | 👍🏽 |\n> > | - | - |\n> > | x \\| y | 2 |",
    "> | a | b |\n> | - | - |\n| 1 | 2 |\n\n| c |\n| - |",
  ])("holds at every position of %j", (text) => {
    for (let head = 0; head <= text.length; head++) {
      const selection = { anchor: 0, head };
      const availability = tableCommandAvailability(text, selection);
      for (const command of TABLE_COMMANDS) {
        const edit = applyTableCommand(text, selection, command, "left");
        expect(availability[command], `${command} at ${head}`).toBe(
          edit !== null,
        );
      }
    }
  });
});

const sources = import.meta.glob(["../**/*.ts", "../**/*.svelte"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("module boundaries", () => {
  it("rewrites tables only through the table commands", () => {
    const rewriters = Object.entries(sources)
      .filter(
        ([path, text]) =>
          !path.endsWith(".test.ts") && /\brenderTableGrid\b/.test(text),
      )
      .map(([path]) => path)
      .sort();
    expect(rewriters).toEqual(["./table-commands.ts", "./table-source.ts"]);
  });

  it("keeps the table commands free of editor and UI imports", () => {
    const text = sources["./table-commands.ts"];
    expect(text).toBeDefined();
    expect(text).not.toMatch(/from "\.\.\/(editor|ui)\//);
  });
});
