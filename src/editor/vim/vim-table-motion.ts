import { CodeMirror, Vim } from "@replit/codemirror-vim";
import { EditorView } from "@codemirror/view";
import { tableEntryLine } from "../table-widgets";

type MotionFn = Parameters<typeof Vim.defineMotion>[1];
type MotionParams = Parameters<MotionFn>;

interface VimMotions {
  readonly moveByLines: MotionFn;
  readonly moveByDisplayLines: MotionFn;
  readonly moveToColumn: MotionFn;
  readonly moveToEol: MotionFn;
}

const moveByLinesIntoTables = function (
  this: VimMotions,
  ...[cm, head, motionArgs, vim, inputState]: MotionParams
): ReturnType<MotionFn> {
  if (vim.lastMotion === moveByLinesIntoTables)
    vim.lastMotion = this.moveByLines;
  const view: unknown = cm.cm6;
  if (motionArgs.repeat === 1 && view instanceof EditorView) {
    const { state } = view;
    const pos = state.doc.line(head.line + 1).from + head.ch;
    const target = tableEntryLine(state, pos, motionArgs.forward ?? true);
    if (target) {
      const last = vim.lastMotion;
      const vertical =
        last === this.moveByLines ||
        last === this.moveByDisplayLines ||
        last === this.moveToColumn ||
        last === this.moveToEol;
      if (!vertical) vim.lastHPos = head.ch;
      const endCh = vertical ? vim.lastHPos : head.ch;
      return new CodeMirror.Pos(
        target.number - 1,
        Math.min(endCh, target.length),
      );
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
  for (const [keys, forward] of [
    ["j", true],
    ["k", false],
    ["<Down>", true],
    ["<Up>", false],
  ] as const) {
    Vim.mapCommand(
      keys,
      "motion",
      "moveByLinesIntoTables",
      { forward, linewise: true },
      {},
    );
  }
}
