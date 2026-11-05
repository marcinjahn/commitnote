import { Vim, type CodeMirror } from "@replit/codemirror-vim";
import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { runTableCommand } from "../table-editing";
import { showVimMessage } from "./vim-command-line";

export interface VimCallbacks {
  readonly onWrite: () => Promise<void>;
  readonly onQuit: () => void;
  readonly onInsertImage?: () => void;
}

export const vimCallbacks: Facet<VimCallbacks, VimCallbacks | null> =
  Facet.define<VimCallbacks, VimCallbacks | null>({
    combine: (values) => values[values.length - 1] ?? null,
  });

function viewOf(cm: CodeMirror): EditorView {
  return cm.cm6;
}

async function write(
  view: EditorView,
  callbacks: VimCallbacks,
): Promise<boolean> {
  try {
    await callbacks.onWrite();
    return true;
  } catch (error) {
    showVimMessage(
      view,
      error instanceof Error ? error.message : String(error),
      true,
    );
    return false;
  }
}

function writeCommand(cm: CodeMirror): void {
  const view = viewOf(cm);
  const callbacks = view.state.facet(vimCallbacks);
  if (callbacks) void write(view, callbacks);
}

function quitCommand(cm: CodeMirror): void {
  viewOf(cm).state.facet(vimCallbacks)?.onQuit();
}

function writeQuitCommand(cm: CodeMirror): void {
  const view = viewOf(cm);
  const callbacks = view.state.facet(vimCallbacks);
  if (!callbacks) return;
  void write(view, callbacks).then((written) => {
    if (written) callbacks.onQuit();
  });
}

function imageCommand(cm: CodeMirror): void {
  const view = viewOf(cm);
  const onInsertImage = view.state.facet(vimCallbacks)?.onInsertImage;
  if (view.state.readOnly || !onInsertImage) {
    showVimMessage(view, "Images cannot be added here.", true);
    return;
  }
  onInsertImage();
}

function tableCommand(cm: CodeMirror): void {
  const view = viewOf(cm);
  if (view.state.readOnly) {
    showVimMessage(view, "Tables cannot be added here.", true);
    return;
  }
  // The selection must reach Vim as an external one so it enters visual mode.
  if (cm.curOp) cm.curOp.isVimOp = false;
  runTableCommand(view, "insert-table");
  if (cm.curOp) cm.curOp.isVimOp = true;
}

let defined = false;

export function defineAppExCommands(): void {
  if (defined) return;
  defined = true;
  Vim.defineEx("write", "w", writeCommand);
  Vim.defineEx("quit", "q", quitCommand);
  Vim.defineEx("wq", "wq", writeQuitCommand);
  Vim.defineEx("xit", "x", writeQuitCommand);
  Vim.defineEx("image", "ima", imageCommand);
  Vim.defineEx("table", "tab", tableCommand);
}
