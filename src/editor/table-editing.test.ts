// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { markdownEditorExtensions } from "./create-markdown-editor";
import {
  runTableCommand,
  tableCellNavigation,
  tableCommandAvailabilityOf,
} from "./table-editing";
import { TABLE_COMMANDS } from "../markdown/table-commands";

const CARET = "¦";
const ANCHOR = "«";
const HEAD = "»";

const TABLE = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");

const views: EditorView[] = [];

function parse(marked: string): {
  doc: string;
  anchor: number;
  head: number;
} {
  const caret = marked.indexOf(CARET);
  if (caret >= 0) {
    return { doc: marked.replace(CARET, ""), anchor: caret, head: caret };
  }
  const anchor = marked.indexOf(ANCHOR);
  const head = marked.indexOf(HEAD);
  return {
    doc: marked.replace(ANCHOR, "").replace(HEAD, ""),
    anchor: anchor < head ? anchor : anchor - 1,
    head: head < anchor ? head : head - 1,
  };
}

function create(
  marked: string,
  { readOnly = false, extra = [] as Extension[] } = {},
): EditorView {
  const { doc, anchor, head } = parse(marked);
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [
        markdownEditorExtensions(),
        EditorState.readOnly.of(readOnly),
        extra,
      ],
    }),
  });
  views.push(view);
  return view;
}

function show(view: EditorView): string {
  const doc = view.state.doc.toString();
  const { anchor, head } = view.state.selection.main;
  if (anchor === head) return doc.slice(0, head) + CARET + doc.slice(head);
  const [from, to] = anchor < head ? [anchor, head] : [head, anchor];
  const [open, close] = anchor < head ? [ANCHOR, HEAD] : [HEAD, ANCHOR];
  return (
    doc.slice(0, from) + open + doc.slice(from, to) + close + doc.slice(to)
  );
}

function press(view: EditorView, key: string, shiftKey = false): boolean {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key, shiftKey }),
    "editor",
  );
}

function type(view: EditorView, text: string): void {
  const { head } = view.state.selection.main;
  view.dispatch({
    changes: { from: head, insert: text },
    selection: { anchor: head + text.length },
    userEvent: "input.type",
  });
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe("runTableCommand", () => {
  it("inserts a table and selects the first header", () => {
    const view = create(`${CARET}`);

    expect(runTableCommand(view, "insert-table")).toBe(true);

    expect(show(view)).toBe(
      [
        "| «Column 1» | Column 2 | Column 3 |",
        "| -------- | -------- | -------- |",
        "|          |          |          |",
        "|          |          |          |",
        "",
      ].join("\n"),
    );
  });

  it("inserts rows and columns", () => {
    const view = create(`| a | b |\n| - | - |\n| 1¦ | 2 |`);

    expect(runTableCommand(view, "insert-row-below")).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |",
    );

    expect(runTableCommand(view, "insert-column-right")).toBe(true);
    expect(view.state.doc.line(1).text.split("|").length).toBe(5);
  });

  it("deletes rows and columns", () => {
    const view = create(`| a | b |\n| - | - |\n| 1 | 2 |\n| 3¦ | 4 |`);

    expect(runTableCommand(view, "delete-row")).toBe(true);
    expect(view.state.doc.lines).toBe(3);

    view.dispatch({ selection: { anchor: 2 } });
    expect(runTableCommand(view, "delete-column")).toBe(true);
    expect(view.state.doc.line(1).text).toBe("| b   |");
  });

  it("aligns a column", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`);

    expect(runTableCommand(view, "align-column", "right")).toBe(true);

    expect(view.state.doc.line(2).text).toBe("| --: | --- |");
  });

  it("formats the table and keeps the caret in its cell", () => {
    const view = create(`| a¦ | bbb |\n| - | - |\n| 1 | 2 |`);

    expect(runTableCommand(view, "format-table")).toBe(true);

    expect(view.state.doc.toString()).toBe(
      "| a   | bbb |\n| --- | --- |\n| 1   | 2   |",
    );
    expect(view.state.selection.main.head).toBe(3);
  });

  it("moves to the next cell and selects its content", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`);

    expect(runTableCommand(view, "next-cell")).toBe(true);

    expect(show(view)).toBe("| a   | «b»   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("returns false and changes nothing when read-only", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`, { readOnly: true });
    const before = view.state.doc.toString();

    expect(runTableCommand(view, "insert-row-below")).toBe(false);
    expect(runTableCommand(view, "insert-table")).toBe(false);

    expect(view.state.doc.toString()).toBe(before);
  });

  it("returns false outside a table", () => {
    const view = create(`plain¦ text`);

    expect(runTableCommand(view, "insert-row-below")).toBe(false);
    expect(view.state.doc.toString()).toBe("plain text");
  });

  it("returns true without changes for previous-cell in the first header cell", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`);
    const state = view.state;

    expect(runTableCommand(view, "previous-cell")).toBe(true);

    expect(view.state).toBe(state);
  });

  it("restores text and selection with one undo", () => {
    const view = create(`| a | b |\n| - | - |\n| 1¦ | 2 |`);
    const before = show(view);

    expect(runTableCommand(view, "insert-row-below")).toBe(true);
    expect(view.state.doc.toString()).not.toBe(before.replace(CARET, ""));
    undo(view);

    expect(show(view)).toBe(before);
  });

  it("keeps the command separate from typing before and after it", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`);
    const original = view.state.doc.toString();

    type(view, "x");
    const typedOnce = view.state.doc.toString();
    runTableCommand(view, "format-table");
    const formatted = view.state.doc.toString();
    expect(formatted).not.toBe(typedOnce);
    type(view, "y");
    const typedTwice = view.state.doc.toString();

    undo(view);
    expect(view.state.doc.toString()).toBe(formatted);
    undo(view);
    expect(view.state.doc.toString()).toBe(typedOnce);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    expect(typedTwice).not.toBe(formatted);
  });
});

describe("tableCommandAvailabilityOf", () => {
  it("is false for every command when read-only", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`, { readOnly: true });

    const availability = tableCommandAvailabilityOf(view.state);

    for (const command of TABLE_COMMANDS) {
      expect(availability[command]).toBe(false);
    }
  });

  it("reports the table commands inside a table", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`);

    const availability = tableCommandAvailabilityOf(view.state);

    expect(availability["insert-table"]).toBe(true);
    expect(availability["next-cell"]).toBe(true);
    expect(availability["insert-row-above"]).toBe(false);
  });

  it("only offers insert table outside a table", () => {
    const view = create(`plain¦`);

    const availability = tableCommandAvailabilityOf(view.state);

    expect(TABLE_COMMANDS.filter((command) => availability[command])).toEqual([
      "insert-table",
    ]);
  });
});

describe("tableCellNavigation", () => {
  const withNavigation = { extra: [tableCellNavigation()] };

  it("moves to the next cell with Tab and formats the table", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`, withNavigation);

    expect(press(view, "Tab")).toBe(true);

    expect(show(view)).toBe("| a   | «b»   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("moves back with Shift-Tab", () => {
    const view = create(`| a | b¦ |\n| - | - |\n| 1 | 2 |`, withNavigation);

    expect(press(view, "Tab", true)).toBe(true);

    expect(show(view)).toBe("| «a»   | b   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("appends a row with Tab in the last cell", () => {
    const view = create(`| a | b |\n| - | - |\n| 1 | 2¦ |`, withNavigation);

    expect(press(view, "Tab")).toBe(true);

    expect(view.state.doc.toString()).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     |     |",
    );
  });

  it("consumes Shift-Tab in the first header cell without changing anything", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`, withNavigation);
    const state = view.state;

    expect(press(view, "Tab", true)).toBe(true);

    expect(view.state).toBe(state);
  });

  it("indents outside a table", () => {
    const view = create(`some¦ text`, withNavigation);

    expect(press(view, "Tab")).toBe(true);

    expect(view.state.doc.toString()).toBe("  some text");
  });

  it("indents in an irregular nested table", () => {
    const view = create(`> | a | b |\n> | - | - |\n| 1¦ | 2 |`, withNavigation);

    expect(press(view, "Tab")).toBe(true);

    expect(view.state.doc.toString()).toBe(
      "> | a | b |\n> | - | - |\n  | 1 | 2 |",
    );
  });

  it("does not run in a read-only view", () => {
    const view = create(`| a¦ | b |\n| - | - |\n| 1 | 2 |`, {
      readOnly: true,
      extra: [tableCellNavigation()],
    });
    const state = view.state;

    expect(press(view, "Tab")).toBe(false);
    expect(view.state).toBe(state);
  });

  it("leaves Tab alone when the selection head is outside the table", () => {
    const view = create(`${TABLE}\n\nafter¦`, withNavigation);

    expect(press(view, "Tab")).toBe(true);

    expect(view.state.doc.toString()).toBe(`${TABLE}\n\n  after`);
  });
});
