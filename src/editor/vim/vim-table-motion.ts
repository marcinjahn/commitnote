import { CodeMirror, Vim } from "@replit/codemirror-vim";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { pageTargetInTable, renderedTableInLines } from "../table-widgets";

type MotionFn = Parameters<typeof Vim.defineMotion>[1];
type MotionParams = Parameters<MotionFn>;
type VimAdapter = MotionParams[0];
type Position = MotionParams[1];
type VimState = MotionParams[3];

interface VimMotions {
  readonly moveByLines: MotionFn;
  readonly moveByDisplayLines: MotionFn;
  readonly moveByScroll: MotionFn;
  readonly moveByPage: MotionFn;
  readonly moveToColumn: MotionFn;
  readonly moveToEol: MotionFn;
}

function firstNonWhitespace(text: string): number {
  const index = text.search(/\S/);
  return index === -1 ? text.length : index;
}

// Upstream compares vim.lastMotion against its own motions to decide whether
// to keep the goal column, so a wrapper must never be left there.
function normaliseLastMotion(vim: VimState, motions: VimMotions): void {
  const last: unknown = vim.lastMotion;
  if (last === moveByLinesIntoTables) vim.lastMotion = motions.moveByLines;
  else if (last === moveByDisplayLinesIntoTables)
    vim.lastMotion = motions.moveByDisplayLines;
  else if (last === moveByScrollIntoTables || last === moveByPageIntoTables)
    vim.lastMotion = motions.moveByScroll;
}

function lastMotionVertical(vim: VimState, motions: VimMotions): boolean {
  const last = vim.lastMotion;
  return (
    last === motions.moveByLines ||
    last === motions.moveByDisplayLines ||
    last === motions.moveByScroll ||
    last === motions.moveToColumn ||
    last === motions.moveToEol
  );
}

function editableView(cm: VimAdapter): EditorView | null {
  const view: unknown = cm.cm6;
  return view instanceof EditorView && !view.state.readOnly ? view : null;
}

function displayMotionView(
  cm: VimAdapter,
  head: Position,
  forward: boolean,
  repeat: number,
): EditorView | null {
  const view = editableView(cm);
  if (!view) return null;
  const { state } = view;
  const crosses = forward
    ? renderedTableInLines(
        state,
        head.line + 2,
        Math.min(head.line + repeat + 1, state.doc.lines),
      )
    : renderedTableInLines(
        state,
        Math.max(head.line + 1 - repeat, 1),
        head.line,
      );
  return crosses ? view : null;
}

// A rendered table is one block widget, which findPosV steps over as a single
// unit, so table lines are stepped one document line at a time instead.
function moveByDisplayLinesThroughTables(
  cm: VimAdapter,
  view: EditorView,
  head: Position,
  forward: boolean,
  repeat: number,
  vim: VimState,
  motions: VimMotions,
): Position {
  const { state } = view;
  const { doc } = state;
  let goalCh: number;
  if (lastMotionVertical(vim, motions)) {
    goalCh = vim.lastHPos;
  } else {
    vim.lastHSPos = cm.charCoords(head, "div").left;
    goalCh = head.ch;
  }
  const inTable = (line: number) =>
    renderedTableInLines(state, line + 1, line + 1);
  const onLine = (line: number) =>
    new CodeMirror.Pos(line, Math.min(goalCh, doc.line(line + 1).length));
  let cur = head;
  let byChar = false;
  for (let i = 0; i < repeat; i++) {
    const next = cur.line + (forward ? 1 : -1);
    if (next < 0 || next >= doc.lines) break;
    if (inTable(cur.line)) {
      cur = onLine(next);
      byChar = true;
      continue;
    }
    const res = cm.findPosV(cur, forward ? 1 : -1, "line", vim.lastHSPos);
    if (res.line !== cur.line && inTable(next)) {
      cur = onLine(next);
      byChar = true;
    } else if (res.hitSide) {
      break;
    } else {
      cur = res;
      byChar = false;
    }
  }
  if (cur !== head) vim.lastHPos = byChar ? goalCh : cur.ch;
  return cur;
}

// Vim's moveByLines steps through view.moveVertically, which treats a rendered
// table as a single line and so overshoots counted motions across it.
const moveByLinesIntoTables = function (
  this: VimMotions,
  ...[cm, head, motionArgs, vim, inputState]: MotionParams
): ReturnType<MotionFn> {
  normaliseLastMotion(vim, this);
  const view = editableView(cm);
  if (view) {
    const { doc } = view.state;
    const forward = motionArgs.forward ?? true;
    const repeat = motionArgs.repeat + (motionArgs.repeatOffset ?? 0);
    const target = Math.min(
      doc.lines - 1,
      Math.max(0, forward ? head.line + repeat : head.line - repeat),
    );
    const crossesTable =
      repeat > 0 &&
      target !== head.line &&
      (forward
        ? renderedTableInLines(view.state, head.line + 2, target + 1)
        : renderedTableInLines(view.state, target + 1, head.line));
    if (crossesTable) {
      const vertical = lastMotionVertical(vim, this);
      if (!vertical) vim.lastHPos = head.ch;
      const endCh = vertical ? vim.lastHPos : head.ch;
      const text = doc.line(target + 1).text;
      let ch: number;
      if (motionArgs.toFirstChar) {
        ch = firstNonWhitespace(text);
        vim.lastHPos = ch;
      } else {
        ch = Math.min(endCh, text.length);
      }
      const pos = new CodeMirror.Pos(target, ch);
      vim.lastHSPos = cm.charCoords(pos, "div").left;
      return pos;
    }
  }
  return this.moveByLines(cm, head, motionArgs, vim, inputState);
};

const moveByDisplayLinesIntoTables = function (
  this: VimMotions,
  ...[cm, head, motionArgs, vim, inputState]: MotionParams
): ReturnType<MotionFn> {
  normaliseLastMotion(vim, this);
  const forward = motionArgs.forward ?? true;
  const repeat = Math.round(motionArgs.repeat);
  const view = displayMotionView(cm, head, forward, repeat);
  if (!view)
    return this.moveByDisplayLines(cm, head, motionArgs, vim, inputState);
  return moveByDisplayLinesThroughTables(
    cm,
    view,
    head,
    forward,
    repeat,
    vim,
    this,
  );
};

const moveByScrollIntoTables = function (
  this: VimMotions,
  ...[cm, head, motionArgs, vim, inputState]: MotionParams
): ReturnType<MotionFn> {
  normaliseLastMotion(vim, this);
  const forward = motionArgs.forward ?? true;
  const info = cm.getScrollInfo();
  const repeat = Math.round(
    motionArgs.repeat || info.clientHeight / (2 * cm.defaultTextHeight()),
  );
  const orig = cm.charCoords(head, "local");
  const view = displayMotionView(cm, head, forward, repeat);
  const end = view
    ? moveByDisplayLinesThroughTables(
        cm,
        view,
        head,
        forward,
        repeat,
        vim,
        this,
      )
    : this.moveByDisplayLines(
        cm,
        head,
        { ...motionArgs, repeat },
        vim,
        inputState,
      );
  if (!end || Array.isArray(end)) return end;
  const dest = cm.charCoords(end, "local");
  cm.scrollTo(null, info.top + dest.top - orig.top);
  return end;
};

// Upstream's findPosV pages by the editor's full height, which here is the
// whole document because the note pane scrolls instead of the editor.
const moveByPageIntoTables = function (
  this: VimMotions,
  ...[cm, head, motionArgs, vim, inputState]: MotionParams
): ReturnType<MotionFn> {
  normaliseLastMotion(vim, this);
  const view = editableView(cm);
  if (!view) return this.moveByPage(cm, head, motionArgs, vim, inputState);
  const forward = motionArgs.forward ?? true;
  const info = cm.getScrollInfo();
  const height = info.clientHeight;
  const orig = cm.charCoords(head, "local");
  if (!lastMotionVertical(vim, this)) {
    vim.lastHPos = head.ch;
    vim.lastHSPos = cm.charCoords(head, "div").left;
  }
  let range = EditorSelection.cursor(
    cm.indexFromPos(head),
    1,
    undefined,
    vim.lastHSPos,
  );
  let end: Position | null = null;
  for (let i = 0; i < motionArgs.repeat; i++) {
    const line = pageTargetInTable(view, range.head, forward, height);
    if (line !== null) {
      const { length } = view.state.doc.line(line);
      end = new CodeMirror.Pos(line - 1, Math.min(vim.lastHPos, length));
      break;
    }
    range = view.moveVertically(range, forward, height);
  }
  end ??= cm.posFromIndex(range.head);
  const dest = cm.charCoords(end, "local");
  cm.scrollTo(null, info.top + dest.top - orig.top);
  return end;
};

let defined = false;

export function defineTableMotions(): void {
  if (defined) return;
  defined = true;
  Vim.defineMotion("moveByLinesIntoTables", moveByLinesIntoTables as MotionFn);
  Vim.defineMotion(
    "moveByDisplayLinesIntoTables",
    moveByDisplayLinesIntoTables as MotionFn,
  );
  Vim.defineMotion(
    "moveByScrollIntoTables",
    moveByScrollIntoTables as MotionFn,
  );
  Vim.defineMotion("moveByPageIntoTables", moveByPageIntoTables as MotionFn);
  // Upstream's <Down>, <Up>, g<Down>, g<Up>, <C-n> and <C-p> are noremap
  // keyToKey defaults, which never reach a remapped target. Mappings without a
  // context leave upstream's insert-mode <C-d> and <C-u> in place.
  for (const [keys, motion, motionArgs] of [
    ["j", "moveByLinesIntoTables", { forward: true, linewise: true }],
    ["k", "moveByLinesIntoTables", { forward: false, linewise: true }],
    ["<Down>", "moveByLinesIntoTables", { forward: true, linewise: true }],
    ["<Up>", "moveByLinesIntoTables", { forward: false, linewise: true }],
    ["<C-n>", "moveByLinesIntoTables", { forward: true, linewise: true }],
    ["<C-p>", "moveByLinesIntoTables", { forward: false, linewise: true }],
    ["+", "moveByLinesIntoTables", { forward: true, toFirstChar: true }],
    ["-", "moveByLinesIntoTables", { forward: false, toFirstChar: true }],
    [
      "_",
      "moveByLinesIntoTables",
      { forward: true, toFirstChar: true, repeatOffset: -1 },
    ],
    ["gj", "moveByDisplayLinesIntoTables", { forward: true }],
    ["g<Down>", "moveByDisplayLinesIntoTables", { forward: true }],
    ["gk", "moveByDisplayLinesIntoTables", { forward: false }],
    ["g<Up>", "moveByDisplayLinesIntoTables", { forward: false }],
    [
      "<C-d>",
      "moveByScrollIntoTables",
      { forward: true, explicitRepeat: true },
    ],
    [
      "<C-u>",
      "moveByScrollIntoTables",
      { forward: false, explicitRepeat: true },
    ],
    ["<C-f>", "moveByPageIntoTables", { forward: true }],
    ["<PageDown>", "moveByPageIntoTables", { forward: true }],
    ["<C-b>", "moveByPageIntoTables", { forward: false }],
    ["<PageUp>", "moveByPageIntoTables", { forward: false }],
  ] as const) {
    Vim.mapCommand(keys, "motion", motion, motionArgs, {});
  }
}
