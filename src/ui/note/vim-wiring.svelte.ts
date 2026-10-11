import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type MarkdownEditor from "../editor/MarkdownEditor.svelte";
import type { VimStatus } from "../../editor/vim/vim-status";
import type { VimBarCommands } from "./vim-bar-commands";

const importVim = () => import("../../editor/vim/vim-extension");
export type VimModule = Awaited<ReturnType<typeof importVim>>;
let vimModule: Promise<VimModule> | undefined;
const loadVim = () => (vimModule ??= importVim());

type EditorHandle = Pick<
  ReturnType<typeof MarkdownEditor>,
  "reconfigure" | "withView"
>;
export type VimInitialMode = "normal" | "insert";

export interface VimWiringOptions {
  editor: () => EditorHandle | null | undefined;
  enabled: () => boolean;
  animatedCaret: () => boolean;
  initialMode: () => VimInitialMode;
  onWrite: () => Promise<void>;
  onQuit: () => void;
}

export interface VimWiring {
  readonly extension: Extension;
  readonly status: VimStatus | null;
  readonly commands: VimBarCommands;
  withVim(fn: (module: VimModule, view: EditorView) => void): void;
}

export function createVimWiring(options: VimWiringOptions): VimWiring {
  const compartment = new Compartment();
  let status = $state<VimStatus | null>(null);
  let vim: {
    module: VimModule;
    editor: EditorHandle;
    animatedCaret: boolean;
  } | null = null;

  $effect(() => {
    const on = options.enabled();
    const target = options.editor();
    const caret = options.animatedCaret();
    if (!on || !target) {
      vim?.editor.reconfigure(compartment, []);
      vim = null;
      status = null;
      return;
    }
    if (vim?.editor === target && vim.animatedCaret === caret) return;
    let current = true;
    void loadVim().then((module) => {
      if (!current) return;
      if (vim?.editor !== target) status = null;
      vim = { module, editor: target, animatedCaret: caret };
      target.reconfigure(
        compartment,
        module.vimExtension({
          initialMode: options.initialMode(),
          animatedCaret: caret,
          onWrite: () => options.onWrite(),
          onQuit: () => options.onQuit(),
          onStatus: (next) => {
            if (vim?.editor === target) status = next;
          },
        }),
      );
    });
    return () => {
      current = false;
    };
  });

  function withVim(fn: (module: VimModule, view: EditorView) => void): void {
    if (vim === null || vim.editor !== options.editor()) return;
    const { module } = vim;
    vim.editor.withView((view) => fn(module, view));
  }

  const commands: VimBarCommands = {
    escape: () => withVim((module, view) => module.vimEscape(view)),
    enterInsert: () => withVim((module, view) => module.vimEnterInsert(view)),
    openCommandLine: (kind) =>
      withVim((module, view) => module.openCommandLine(view, kind)),
    keyDown: (event, value) =>
      withVim((module, view) => module.commandLineKeyDown(view, event, value)),
    keyUp: (event, value) =>
      withVim((module, view) => module.commandLineKeyUp(view, event, value)),
    input: (event, value) =>
      withVim((module, view) => module.commandLineInput(view, event, value)),
    close: () => withVim((module, view) => module.closeCommandLine(view)),
  };

  return {
    extension: compartment.of([]),
    get status() {
      return status;
    },
    commands,
    withVim,
  };
}
