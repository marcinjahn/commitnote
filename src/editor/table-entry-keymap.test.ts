// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { type EditorView, runScopeHandlers } from "@codemirror/view";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import {
  enterTableDown,
  enterTableUp,
  tableWidgets,
  tableWidgetsField,
} from "./table-widgets";

const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |";

let editor: MarkdownEditor | null = null;
let parent: HTMLElement | null = null;

function setup(text: string, line: number, column = 0): EditorView {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  editor = createMarkdownEditor({
    parent,
    text,
    readOnly: false,
    onChange: () => {},
    extensions: [tableWidgets()],
  });
  const view = editor.view;
  view.dispatch({
    selection: { anchor: view.state.doc.line(line).from + column },
  });
  return view;
}

function press(view: EditorView, key: "ArrowDown" | "ArrowUp"): boolean {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key }),
    "editor",
  );
}

function cursorOf(view: EditorView): { line: number; column: number } {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, column: head - line.from };
}

function rendersTable(view: EditorView): boolean {
  let found = false;
  view.state
    .field(tableWidgetsField)
    .between(0, view.state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget) found = true;
    });
  return found;
}

afterEach(() => {
  editor?.destroy();
  parent?.remove();
  editor = null;
  parent = null;
});

describe("table entry arrow keys", () => {
  it("lands ArrowDown on the table's first line from the line directly above and reveals it", () => {
    const view = setup(`Intro\n\n## a\n${TABLE}\n\nafter`, 3, 2);
    expect(rendersTable(view)).toBe(true);

    expect(press(view, "ArrowDown")).toBe(true);

    expect(cursorOf(view)).toEqual({ line: 4, column: 2 });
    expect(rendersTable(view)).toBe(false);
  });

  it("lands ArrowUp on the table's last line from the line directly below", () => {
    const view = setup(`Intro\n\n${TABLE}\n\nafter`, 6);

    expect(press(view, "ArrowUp")).toBe(true);

    expect(cursorOf(view)).toEqual({ line: 5, column: 0 });
    expect(rendersTable(view)).toBe(false);
  });

  it("clamps the column to the table line's length", () => {
    const below = "## a heading longer than the row";
    const view = setup(`Intro\n\n${TABLE}\n${below}`, 6, below.length);
    expect(rendersTable(view)).toBe(true);

    expect(press(view, "ArrowUp")).toBe(true);

    expect(cursorOf(view)).toEqual({ line: 5, column: "| 1 | 2 |".length });
  });

  it("leaves the commands unhandled without an adjacent rendered table", () => {
    const view = setup(`Intro\n\nplain\n\n${TABLE}\n\nafter`, 1);

    expect(enterTableDown(view)).toBe(false);
    expect(enterTableUp(view)).toBe(false);

    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
    expect(enterTableUp(view)).toBe(false);
    expect(cursorOf(view).line).toBe(4);
  });

  it("leaves a non-empty selection to the default behaviour", () => {
    const view = setup(`Intro\n\n${TABLE}\n\nafter`, 2);
    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.line(2).from },
    });

    expect(enterTableDown(view)).toBe(false);
  });
});
