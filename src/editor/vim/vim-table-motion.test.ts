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

const CHAR_WIDTH = 10;
const LINE_HEIGHT = 20;

beforeAll(() => {
  EditorView.prototype.coordsAtPos = function (pos) {
    const line = this.state.doc.lineAt(pos);
    const left = (pos - line.from) * CHAR_WIDTH;
    return {
      left,
      right: left,
      top: (line.number - 1) * LINE_HEIGHT,
      bottom: line.number * LINE_HEIGHT,
    };
  };
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
    const goal = start.goalColumn ?? this.coordsAtPos(start.head)!.left;
    const column = Math.round(goal / CHAR_WIDTH);
    return EditorSelection.cursor(
      Math.min(target.from + column, target.to),
      start.assoc,
      undefined,
      goal,
    );
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

describe("counted line motions across a rendered table", () => {
  const AFTER = BELOW + 1;

  it.each([
    { keys: ["2", "j"], from: ABOVE, to: FIRST + 1 },
    { keys: ["3", "j"], from: ABOVE, to: LAST },
    { keys: ["3", "j"], from: ABOVE - 1, to: FIRST + 1 },
    { keys: ["2", "k"], from: BELOW, to: FIRST + 1 },
    { keys: ["4", "k"], from: AFTER, to: FIRST },
    { keys: ["2", "<Down>"], from: ABOVE, to: FIRST + 1 },
    { keys: ["2", "<Up>"], from: BELOW, to: FIRST + 1 },
    { keys: ["2", "+"], from: ABOVE, to: FIRST + 1 },
    { keys: ["2", "-"], from: BELOW, to: FIRST + 1 },
    { keys: ["3", "_"], from: ABOVE, to: FIRST + 1 },
    { keys: ["2", "<CR>"], from: ABOVE, to: FIRST + 1 },
  ])(
    "lands $keys from line $from on table line $to and reveals it",
    async ({ keys, from, to }) => {
      const view = await setup(from);
      expect(rendersTable(view.state)).toBe(true);

      await press(view, ...keys);

      expect(cursorOf(view)).toEqual({ line: to, column: 0 });
      expect(rendersTable(view.state)).toBe(false);
    },
  );

  it.each([
    { keys: ["4", "j"], from: ABOVE, to: BELOW },
    { keys: ["5", "k"], from: AFTER, to: ABOVE },
    { keys: ["2", "0", "j"], from: ABOVE, to: AFTER },
  ])(
    "passes $keys from line $from through the table to line $to",
    async ({ keys, from, to }) => {
      const view = await setup(from);

      await press(view, ...keys);

      expect(cursorOf(view).line).toBe(to);
      expect(rendersTable(view.state)).toBe(true);
    },
  );

  it("moves the counted lines when no table lies in the way", async () => {
    const view = await setup(1);

    await press(view, "2", "j");

    expect(cursorOf(view).line).toBe(3);
    expect(rendersTable(view.state)).toBe(true);
  });

  it("keeps the goal column on a counted motion into the table", async () => {
    const view = await setup(ABOVE - 1);
    await press(view, "l", "l", "l");

    await press(view, "3", "j");

    expect(cursorOf(view)).toEqual({ line: FIRST + 1, column: 3 });
  });

  it("deletes the counted lines into the table with d2j", async () => {
    const view = await setup(ABOVE);

    await press(view, "d", "2", "j");

    expect(view.state.doc.toString()).toBe(
      "0123456789\nab\n0123456789\n| 1 | 2 |\n\nafter line",
    );
  });

  it("extends a linewise Visual selection over the table with V3j", async () => {
    const view = await setup(ABOVE);

    await press(view, "V", "3", "j", "d");

    expect(view.state.doc.toString()).toBe(
      "0123456789\nab\n0123456789\n\nafter line",
    );
  });

  it("goes to a table line with NG and reveals it", async () => {
    const view = await setup(1);

    await press(view, "6", "G");

    expect(cursorOf(view).line).toBe(FIRST + 1);
    expect(rendersTable(view.state)).toBe(false);
  });

  it("goes to a table line with :N and reveals it", async () => {
    const view = await setup(1);
    const cm = getCM(view);
    if (!cm) throw new Error("vim is not attached");

    Vim.handleEx(cm as Parameters<typeof Vim.handleEx>[0], "7");
    await settle();

    expect(cursorOf(view).line).toBe(LAST);
    expect(rendersTable(view.state)).toBe(false);
  });
});

describe("display-line and half-page motions across a rendered table", () => {
  const AFTER = BELOW + 1;

  it.each([
    { keys: ["g", "j"], from: ABOVE, to: FIRST },
    { keys: ["g", "k"], from: BELOW, to: LAST },
    { keys: ["2", "g", "j"], from: ABOVE, to: FIRST + 1 },
    { keys: ["3", "g", "j"], from: ABOVE - 1, to: FIRST + 1 },
    { keys: ["g", "<Down>"], from: ABOVE, to: FIRST },
    { keys: ["g", "<Up>"], from: BELOW, to: LAST },
    { keys: ["3", "<C-d>"], from: ABOVE, to: LAST },
    { keys: ["3", "<C-u>"], from: AFTER, to: FIRST + 1 },
    { keys: ["<C-n>"], from: ABOVE, to: FIRST },
    { keys: ["2", "<C-p>"], from: BELOW, to: FIRST + 1 },
  ])(
    "lands $keys from line $from on table line $to and reveals it",
    async ({ keys, from, to }) => {
      const view = await setup(from);
      expect(rendersTable(view.state)).toBe(true);

      await press(view, ...keys);

      expect(cursorOf(view)).toEqual({ line: to, column: 0 });
      expect(rendersTable(view.state)).toBe(false);
    },
  );

  it.each([
    { keys: ["4", "g", "j"], from: ABOVE, to: BELOW },
    { keys: ["5", "g", "k"], from: AFTER, to: ABOVE },
  ])(
    "passes $keys from line $from through the table to line $to",
    async ({ keys, from, to }) => {
      const view = await setup(from);

      await press(view, ...keys);

      expect(cursorOf(view).line).toBe(to);
      expect(rendersTable(view.state)).toBe(true);
    },
  );

  it("moves the counted display lines when no table lies in the way", async () => {
    const view = await setup(1);

    await press(view, "2", "g", "j");

    expect(cursorOf(view).line).toBe(3);
    expect(rendersTable(view.state)).toBe(true);
  });

  it("keeps the goal column on a counted display-line motion into the table", async () => {
    const view = await setup(ABOVE - 1);
    await press(view, "l", "l", "l");

    await press(view, "3", "g", "j");

    expect(cursorOf(view)).toEqual({ line: FIRST + 1, column: 3 });
  });

  it("keeps the pixel goal of repeated gj across a short line", async () => {
    const view = await setup(1);
    await press(view, "l", "l", "l", "l", "l", "l");

    await press(view, "g", "j", "g", "j");

    expect(cursorOf(view)).toEqual({ line: 3, column: 6 });
  });

  it("continues j with gj from the goal Vim kept for j", async () => {
    const view = await setup(1);
    await press(view, "l", "l", "l", "l", "l", "l");

    await press(view, "j", "g", "j");

    expect(cursorOf(view)).toEqual({ line: 3, column: 2 });
  });

  it("deletes the display lines into the table with V2gjd", async () => {
    const view = await setup(ABOVE);

    await press(view, "V", "2", "g", "j", "d");

    expect(view.state.doc.toString()).toBe(
      "0123456789\nab\n0123456789\n| 1 | 2 |\n\nafter line",
    );
  });

  it("deletes characterwise up to the table line with d2gj", async () => {
    const view = await setup(ABOVE);

    await press(view, "d", "2", "g", "j");

    expect(view.state.doc.toString()).toBe(
      "0123456789\nab\n0123456789\n\n| - | - |\n| 1 | 2 |\n\nafter line",
    );
  });

  it("keeps Vim's insert-mode <C-u>", async () => {
    const view = await setup(1);
    await press(view, "l", "l", "l", "l", "l", "l", "i");

    await press(view, "<C-u>");

    expect(view.state.doc.line(1).text).toBe("6789");
    expect(getCM(view)?.state.vim?.insertMode).toBe(true);
  });
});
