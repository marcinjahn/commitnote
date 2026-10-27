import { CodeMirror, Vim } from "@replit/codemirror-vim";
import { EditorView } from "@codemirror/view";
import { renderedTableInLines } from "../table-widgets";

type MotionFn = Parameters<typeof Vim.defineMotion>[1];
type MotionParams = Parameters<MotionFn>;

interface VimMotions {
  readonly moveByLines: MotionFn;
  readonly moveByDisplayLines: MotionFn;
  readonly moveToColumn: MotionFn;
  readonly moveToEol: MotionFn;
}

function firstNonWhitespace(text: string): number {
  const index = text.search(/\S/);
  return index === -1 ? text.length : index;
}

// Vim's moveByLines steps through view.moveVertically, which treats a rendered
// table as a single line and so overshoots counted motions across it.
const moveByLinesIntoTables = function (
  this: VimMotions,
  ...[cm, head, motionArgs, vim, inputState]: MotionParams
): ReturnType<MotionFn> {
  if (vim.lastMotion === moveByLinesIntoTables)
    vim.lastMotion = this.moveByLines;
  const view: unknown = cm.cm6;
  if (view instanceof EditorView && !view.state.readOnly) {
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
      const last = vim.lastMotion;
      const vertical =
        last === this.moveByLines ||
        last === this.moveByDisplayLines ||
        last === this.moveToColumn ||
        last === this.moveToEol;
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

let defined = false;

export function defineTableMotions(): void {
  if (defined) return;
  defined = true;
  Vim.defineMotion("moveByLinesIntoTables", moveByLinesIntoTables as MotionFn);
  // <Down> and <Up> are noremap keyToKey defaults, which never reach a mapped j/k.
  for (const [keys, motionArgs] of [
    ["j", { forward: true, linewise: true }],
    ["k", { forward: false, linewise: true }],
    ["<Down>", { forward: true, linewise: true }],
    ["<Up>", { forward: false, linewise: true }],
    ["+", { forward: true, toFirstChar: true }],
    ["-", { forward: false, toFirstChar: true }],
    ["_", { forward: true, toFirstChar: true, repeatOffset: -1 }],
  ] as const) {
    Vim.mapCommand(keys, "motion", "moveByLinesIntoTables", motionArgs, {});
  }
}
