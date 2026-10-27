// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Vim, getCM } from "@replit/codemirror-vim";
import { markdownEditorExtensions } from "../create-markdown-editor";
import { tableWidgets, tableWidgetsField } from "../table-widgets";
import { vimExtension } from "./vim-extension";
import { defineTableMotions } from "./vim-table-motion";

const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |";
const DOC = `0123456789\nab\n0123456789\n\n${TABLE}\n\nafter line`;
const ABOVE = 4;
const FIRST = 5;
const LAST = 7;
const BELOW = 8;

const views: EditorView[] = [];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function rendersTable(state: EditorState): boolean {
  let found = false;
  state
    .field(tableWidgetsField)
    .between(0, state.doc.length, (_f, _t, deco) => {
      if (deco.spec.widget) found = true;
    });
  return found;
}

async function setup(line = 1): Promise<EditorView> {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: DOC,
      extensions: [
        markdownEditorExtensions(),
        tableWidgets(),
        vimExtension({
          initialMode: "normal",
          animatedCaret: true,
          onWrite: async () => {},
          onQuit: () => {},
        }),
      ],
    }),
  });
  views.push(view);
  await settle();
  view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
  return view;
}

async function press(view: EditorView, ...keys: string[]): Promise<void> {
  const cm = getCM(view);
  if (!cm) throw new Error("vim is not attached");
  for (const key of keys) Vim.handleKey(cm, key, "user");
  await settle();
}

function cursorOf(view: EditorView): { line: number; column: number } {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, column: head - line.from };
}

beforeAll(() => {
  EditorView.prototype.moveVertically = function (start, forward) {
    const doc = this.state.doc;
    const line = doc.lineAt(start.head);
    let target = doc.line(
      Math.min(doc.lines, Math.max(1, line.number + (forward ? 1 : -1))),
    );
    this.state
      .field(tableWidgetsField, false)
      ?.between(target.from, target.from, (from, to, deco) => {
        if (!deco.spec.widget) return;
        const past = forward
          ? doc.lineAt(to).number + 1
          : doc.lineAt(from).number - 1;
        target = doc.line(Math.min(doc.lines, Math.max(1, past)));
      });
    const column = start.head - line.from;
    return EditorSelection.cursor(Math.min(target.from + column, target.to));
  };
});

beforeEach(() => {
  Vim.resetVimGlobalState_();
});

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe("moveByLinesIntoTables", () => {
  it("enters the table's first line with j from the line directly above and reveals it", async () => {
    const view = await setup(ABOVE);
    expect(rendersTable(view.state)).toBe(true);

    await press(view, "j");

    expect(cursorOf(view)).toEqual({ line: FIRST, column: 0 });
    expect(rendersTable(view.state)).toBe(false);
  });

  it("enters the table's last line with k from the line directly below", async () => {
    const view = await setup(BELOW);

    await press(view, "k");

    expect(cursorOf(view)).toEqual({ line: LAST, column: 0 });
    expect(rendersTable(view.state)).toBe(false);
  });

  it("enters the table with Vim's <Down> and <Up>", async () => {
    const view = await setup(ABOVE);

    await press(view, "<Down>");
    expect(cursorOf(view).line).toBe(FIRST);

    view.dispatch({ selection: { anchor: view.state.doc.line(BELOW).from } });
    await press(view, "<Up>");
    expect(cursorOf(view).line).toBe(LAST);
  });

  it("moves exactly one line with j and k away from a table", async () => {
    const view = await setup(1);

    await press(view, "j");
    expect(cursorOf(view).line).toBe(2);

    await press(view, "j");
    expect(cursorOf(view).line).toBe(3);

    await press(view, "k");
    expect(cursorOf(view).line).toBe(2);
    expect(rendersTable(view.state)).toBe(true);
  });

  it("keeps the goal column across short lines and into the table", async () => {
    const view = await setup(1);
    await press(view, "l", "l", "l", "l", "l", "l");

    await press(view, "j");
    expect(cursorOf(view)).toEqual({ line: 2, column: 1 });

    await press(view, "j");
    expect(cursorOf(view)).toEqual({ line: 3, column: 6 });

    await press(view, "j");
    expect(cursorOf(view)).toEqual({ line: ABOVE, column: 0 });

    await press(view, "j");
    expect(cursorOf(view)).toEqual({ line: FIRST, column: 6 });
  });

  it("keeps the goal column when entering the table upward", async () => {
    const view = await setup(BELOW + 1);
    await press(view, "l", "l", "l");

    await press(view, "k", "k");

    expect(cursorOf(view)).toEqual({ line: LAST, column: 3 });
  });

  it("maps j and k only once when defined again", async () => {
    const view = await setup(ABOVE);
    const mapCommand = vi.spyOn(Vim, "mapCommand");
    const defineMotion = vi.spyOn(Vim, "defineMotion");

    defineTableMotions();
    defineTableMotions();

    expect(mapCommand).not.toHaveBeenCalled();
    expect(defineMotion).not.toHaveBeenCalled();
    mapCommand.mockRestore();
    defineMotion.mockRestore();

    await press(view, "j");
    expect(cursorOf(view).line).toBe(FIRST);

    await press(view, "j");
    expect(cursorOf(view).line).toBe(FIRST + 1);
  });
});
