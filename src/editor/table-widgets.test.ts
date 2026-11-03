import { describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type EditorStateConfig,
} from "@codemirror/state";
import { markdownEditorExtensions } from "./create-markdown-editor";
import { TableWidget } from "./table-widget";
import {
  tableEntryLine,
  tableWidgets,
  tableWidgetsField,
} from "./table-widgets";

const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |";

function stateFor(
  doc: string,
  selection: EditorStateConfig["selection"] = EditorSelection.cursor(0),
  readOnly = false,
): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      markdownEditorExtensions(),
      tableWidgets(),
      EditorState.readOnly.of(readOnly),
    ],
  });
}

interface Found {
  readonly widgets: Array<{ from: number; to: number; widget: TableWidget }>;
  readonly lines: number[];
  readonly marks: Array<[number, number]>;
}

function decorations(state: EditorState): Found {
  const found: Found = { widgets: [], lines: [], marks: [] };
  state
    .field(tableWidgetsField)
    .between(0, state.doc.length, (from, to, deco) => {
      const widget: unknown = deco.spec.widget;
      if (widget instanceof TableWidget) {
        expect(deco.spec.block).toBe(true);
        found.widgets.push({ from, to, widget });
      } else if (deco.spec.class === "cm-table-source-line") {
        found.lines.push(from);
      } else {
        expect(deco.spec.class).toBe("cm-table-delimiter");
        found.marks.push([from, to]);
      }
    });
  return found;
}

function lineStarts(doc: string, from: number, count: number): number[] {
  const state = EditorState.create({ doc });
  const first = state.doc.lineAt(from).number;
  return Array.from(
    { length: count },
    (_, index) => state.doc.line(first + index).from,
  );
}

function delimiterRanges(
  doc: string,
  from: number,
  count: number,
  prefix = 0,
): Array<[number, number]> {
  const state = EditorState.create({ doc });
  const first = state.doc.lineAt(from).number;
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < count; index++) {
    const line = state.doc.line(first + index);
    const start = line.from + prefix;
    if (index === 1) {
      ranges.push([start, line.to]);
      continue;
    }
    for (let pos = start; pos < line.to; pos++) {
      if (doc[pos] === "|") ranges.push([pos, pos + 1]);
    }
  }
  return ranges;
}

describe("tableWidgetsField", () => {
  it("renders a top-level table away from the cursor as one block widget over its full lines", () => {
    const doc = `Intro\n\n${TABLE}\n\nafter`;
    const from = doc.indexOf("|");
    const { widgets, lines, marks } = decorations(stateFor(doc));

    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.from).toBe(from);
    expect(widgets[0]?.to).toBe(from + TABLE.length);
    expect(widgets[0]?.widget.source).toBe(TABLE);
    expect(widgets[0]?.widget.from).toBe(from);
    expect(widgets[0]?.widget.readOnly).toBe(false);
    expect(widgets[0]?.widget.table.rows).toHaveLength(1);
    expect(lines).toEqual([]);
    expect(marks).toEqual([]);
  });

  it("covers the full lines of a table written without outer pipes", () => {
    const table = "a | b\n--|--\n1 | 2";
    const doc = `Intro\n\n${table}\n\nafter`;
    const from = doc.indexOf("a |");
    const { widgets } = decorations(stateFor(doc));

    expect(widgets.map(({ from, to }) => [from, to])).toEqual([
      [from, from + table.length],
    ]);
    expect(widgets[0]?.widget.table.header.cells).toHaveLength(2);
  });

  it("reveals the table source when the cursor is on any table line", () => {
    const doc = `Intro\n\n${TABLE}\n\nafter`;
    const from = doc.indexOf("|");
    const expectedLines = lineStarts(doc, from, 3);
    const expectedMarks = delimiterRanges(doc, from, 3);

    for (const cursor of [
      from,
      from + TABLE.indexOf("b"),
      from + TABLE.indexOf("-"),
      from + TABLE.length,
    ]) {
      const found = decorations(stateFor(doc, EditorSelection.cursor(cursor)));
      expect(found.widgets).toEqual([]);
      expect(found.lines).toEqual(expectedLines);
      expect(found.marks).toEqual(expectedMarks);
    }
  });

  it("reveals the table when a selection merely touches its first or last line", () => {
    const doc = `Intro\n\n${TABLE}\n\nafter`;
    const from = doc.indexOf("|");
    const to = from + TABLE.length;

    expect(
      decorations(stateFor(doc, EditorSelection.range(0, from))).widgets,
    ).toEqual([]);
    expect(
      decorations(stateFor(doc, EditorSelection.range(to, doc.length))).widgets,
    ).toEqual([]);
    expect(
      decorations(stateFor(doc, EditorSelection.range(0, from - 1))).widgets,
    ).toHaveLength(1);
  });

  it("renders the table in a read-only state even with the cursor inside", () => {
    const doc = `Intro\n\n${TABLE}`;
    const inside = doc.indexOf("b");
    const { widgets, lines } = decorations(
      stateFor(doc, EditorSelection.cursor(inside), true),
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.widget.readOnly).toBe(true);
    expect(lines).toEqual([]);
  });

  it("never renders a table inside a blockquote", () => {
    const quoted = "> | a | b |\n> | - | - |\n> | 1 | 2 |";
    const doc = `Intro\n\n${quoted}\n\nafter`;
    const from = doc.indexOf(">");
    const { widgets, lines, marks } = decorations(stateFor(doc));

    expect(widgets).toEqual([]);
    expect(lines).toEqual(lineStarts(doc, from, 3));
    expect(marks).toEqual(delimiterRanges(doc, from, 3, 2));
  });

  it("never renders a table inside a list item", () => {
    const listed = "- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |";
    const doc = `Intro\n\n${listed}\n\nafter`;
    const from = doc.indexOf("| a");
    const { widgets, lines, marks } = decorations(stateFor(doc));

    expect(widgets).toEqual([]);
    expect(lines).toEqual(lineStarts(doc, from, 3));
    expect(marks).toEqual(delimiterRanges(doc, from, 3, 2));
  });

  it("reveals only the touched table of two", () => {
    const second = "| c | d |\n| - | - |\n| 3 | 4 |";
    const doc = `${TABLE}\n\nbetween\n\n${second}\n\nafter`;
    const secondFrom = doc.indexOf("| c");
    const found = decorations(
      stateFor(doc, EditorSelection.cursor(doc.indexOf("d"))),
    );

    expect(found.widgets.map((w) => [w.from, w.to])).toEqual([
      [0, TABLE.length],
    ]);
    expect(found.lines).toEqual(lineStarts(doc, secondFrom, 3));
  });
});

describe("TableWidget", () => {
  const doc = `Intro\n\n${TABLE}`;

  function widgetOf(state: EditorState): TableWidget {
    const widget = decorations(state).widgets[0]?.widget;
    if (!widget) throw new Error("table widget not rendered");
    return widget;
  }

  it("is equal for the same source and read-only state only", () => {
    const base = widgetOf(stateFor(doc));

    expect(base.eq(widgetOf(stateFor(doc)))).toBe(true);
    expect(base.eq(widgetOf(stateFor(doc, undefined, true)))).toBe(false);
    expect(base.eq(widgetOf(stateFor(doc.replace("| 2 |", "| 9 |"))))).toBe(
      false,
    );
  });

  it("is equal for an identical table moved by an edit above it", () => {
    const state = stateFor(doc);
    const moved = state.update({ changes: { from: 0, insert: "More " } }).state;
    const before = widgetOf(state);
    const after = widgetOf(moved);

    expect(after.from).toBe(before.from + 5);
    expect(before.eq(after)).toBe(true);
  });

  it("estimates its height from the row count", () => {
    expect(widgetOf(stateFor("Intro\n\n| a |\n| - |")).estimatedHeight).toBe(
      50,
    );
    expect(
      widgetOf(stateFor("Intro\n\n| a |\n| - |\n| 1 |\n| 2 |\n| 3 |"))
        .estimatedHeight,
    ).toBe(152);
  });
});

describe("tableWidgetsField updates", () => {
  it("keeps the same value on a selection change in a document with no tables", () => {
    const state = stateFor("plain\ntext\nhere");
    const before = state.field(tableWidgetsField);
    const after = state
      .update({ selection: EditorSelection.cursor(8) })
      .state.field(tableWidgetsField);

    expect(after).toBe(before);
  });

  it("rebuilds when a selection enters a table", () => {
    const doc = `Intro\n\n${TABLE}`;
    const state = stateFor(doc);
    const next = state.update({
      selection: EditorSelection.cursor(doc.indexOf("b")),
    }).state;

    expect(next.field(tableWidgetsField)).not.toBe(
      state.field(tableWidgetsField),
    );
    expect(decorations(next).widgets).toEqual([]);
  });

  it("reveals a table completed by typing its delimiter row, then renders it once the cursor leaves", () => {
    const doc = "Intro\n\n| a | b |\n\nafter";
    const insertAt = doc.indexOf("|") + "| a | b |".length;
    let state = stateFor(doc, EditorSelection.cursor(insertAt));
    expect(decorations(state)).toEqual({ widgets: [], lines: [], marks: [] });

    state = state.update({
      changes: { from: insertAt, insert: "\n| - | - |" },
      selection: EditorSelection.cursor(insertAt + 10),
    }).state;
    const revealed = decorations(state);
    expect(revealed.widgets).toEqual([]);
    expect(revealed.lines).toHaveLength(2);

    state = state.update({ selection: EditorSelection.cursor(0) }).state;
    expect(decorations(state).widgets).toHaveLength(1);
  });

  it("never changes the document text", () => {
    const doc = `Intro\n\n${TABLE}\n\n> | x |\n> | - |`;
    let state = stateFor(doc);
    decorations(state);
    state = state.update({
      selection: EditorSelection.cursor(doc.indexOf("b")),
    }).state;
    decorations(state);

    expect(state.doc.toString()).toBe(doc);
  });
});

describe("tableEntryLine", () => {
  const doc = `Intro\n\n${TABLE}\n\nafter`;

  function lineNumberOf(
    state: EditorState,
    lineNumber: number,
    forward: boolean,
  ): number | null {
    const pos = state.doc.line(lineNumber).from;
    return tableEntryLine(state, pos, forward)?.number ?? null;
  }

  it("returns the first table line going forward from the line directly above", () => {
    const state = stateFor(doc);
    const target = tableEntryLine(state, state.doc.line(2).from, true);

    expect(target?.number).toBe(3);
    expect(target?.text).toBe("| a | b |");
  });

  it("returns the last table line going backward from the line directly below", () => {
    const state = stateFor(doc);
    const target = tableEntryLine(state, state.doc.line(6).from, false);

    expect(target?.number).toBe(5);
    expect(target?.text).toBe("| 1 | 2 |");
  });

  it("returns null two lines away from the table", () => {
    const state = stateFor(doc);

    expect(lineNumberOf(state, 1, true)).toBeNull();
    expect(lineNumberOf(state, 7, false)).toBeNull();
  });

  it("returns null for the opposite direction", () => {
    const state = stateFor(doc);

    expect(lineNumberOf(state, 2, false)).toBeNull();
    expect(lineNumberOf(state, 6, true)).toBeNull();
  });

  it("returns null for a revealed table", () => {
    const state = stateFor(doc, EditorSelection.cursor(doc.indexOf("b")));

    expect(lineNumberOf(state, 2, true)).toBeNull();
    expect(lineNumberOf(state, 6, false)).toBeNull();
  });

  it("returns null for a nested table", () => {
    const quoted = "Intro\n\n> | a | b |\n> | - | - |\n> | 1 | 2 |\n\nafter";
    const state = stateFor(quoted);

    expect(lineNumberOf(state, 2, true)).toBeNull();
    expect(lineNumberOf(state, 6, false)).toBeNull();
  });

  it("returns null in a read-only state", () => {
    const state = stateFor(doc, undefined, true);

    expect(lineNumberOf(state, 2, true)).toBeNull();
    expect(lineNumberOf(state, 6, false)).toBeNull();
  });

  it("returns null in a state without the table widgets field", () => {
    const state = EditorState.create({
      doc,
      extensions: markdownEditorExtensions(),
    });

    expect(lineNumberOf(state, 2, true)).toBeNull();
    expect(lineNumberOf(state, 6, false)).toBeNull();
  });

  it("returns null past the document's first or last line", () => {
    const leading = stateFor(
      `${TABLE}\n\nafter`,
      EditorSelection.cursor(TABLE.length + 2),
    );
    const trailing = stateFor(`Intro\n\n${TABLE}`);

    expect(decorations(leading).widgets).toHaveLength(1);
    expect(lineNumberOf(leading, 1, false)).toBeNull();
    expect(decorations(trailing).widgets).toHaveLength(1);
    expect(lineNumberOf(trailing, 5, true)).toBeNull();
  });
});
