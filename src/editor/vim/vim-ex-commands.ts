import { Vim, type CodeMirror } from "@replit/codemirror-vim";
import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { showVimMessage } from "./vim-command-line";

export interface VimCallbacks {
  readonly onWrite: () => Promise<void>;
  readonly onQuit: () => void;
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

let defined = false;

export function defineAppExCommands(): void {
  if (defined) return;
  defined = true;
  Vim.defineEx("write", "w", writeCommand);
  Vim.defineEx("quit", "q", quitCommand);
  Vim.defineEx("wq", "wq", writeQuitCommand);
  Vim.defineEx("xit", "x", writeQuitCommand);
}
