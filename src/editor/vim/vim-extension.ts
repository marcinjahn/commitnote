import { CodeMirror, Vim, getCM, vim } from "@replit/codemirror-vim";
import { Facet, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  drawSelection,
  runScopeHandlers,
  type ViewUpdate,
} from "@codemirror/view";
import { relativeLineNumbers } from "./relative-line-numbers";
import { useSystemClipboard } from "./vim-clipboard";
import { adoptVimDialogs, discardCommandLine } from "./vim-command-line";
import { defineAppExCommands, vimCallbacks } from "./vim-ex-commands";
import {
  initialEditingMode,
  setVimStatus,
  vimStatusField,
  vimStatusOf,
  type VimEditingMode,
  type VimStatus,
  type VimStatusUpdate,
} from "./vim-status";

export interface VimExtensionOptions {
  readonly initialMode: "normal" | "insert";
  readonly animatedCaret: boolean;
  readonly onWrite: () => Promise<void>;
  readonly onQuit: () => void;
  readonly onStatus?: (status: VimStatus) => void;
}

export {
  closeCommandLine,
  commandLineInput,
  commandLineKeyDown,
  commandLineKeyUp,
  openCommandLine,
} from "./vim-command-line";
export { vimCallbacks, type VimCallbacks } from "./vim-ex-commands";

interface VimConfig {
  readonly initialMode: "normal" | "insert";
  readonly animatedCaret: boolean;
  readonly onStatus?: (status: VimStatus) => void;
}

type VimAdapter = NonNullable<ReturnType<typeof getCM>>;

const lastOf = <T>(values: readonly T[]): T | undefined =>
  values[values.length - 1];

const vimConfig = Facet.define<VimConfig, VimConfig>({
  combine: (values) =>
    lastOf(values) ?? { initialMode: "normal", animatedCaret: true },
});

const PLAIN_CARET_CLASS = "cm-vim-plain-caret";
const REPLACE_CLASS = "cm-vim-replace";

function editingModeFrom(event: {
  mode: string;
  subMode?: string;
}): VimEditingMode {
  switch (event.mode) {
    case "insert":
      return "insert";
    case "replace":
      return "replace";
    case "visual":
      if (event.subMode === "linewise") return "visual-line";
      if (event.subMode === "blockwise") return "visual-block";
      return "visual";
    default:
      return "normal";
  }
}

const sameStatus = (status: VimStatus, update: VimStatusUpdate): boolean =>
  (Object.keys(update) as (keyof VimStatusUpdate)[]).every(
    (key) => status[key] === update[key],
  );

class VimSession {
  mode: VimEditingMode = "normal";
  private scheduled = false;
  private destroyed = false;
  private readonly cm: VimAdapter | null;
  private readonly releaseDialogs: (() => void) | null = null;
  private readonly onModeChange = (event: {
    mode: string;
    subMode?: string;
  }) => {
    this.mode = editingModeFrom(event);
    this.view.setTabFocusMode(this.mode !== "insert");
    this.schedule();
  };
  private readonly onActivity = () => this.schedule();

  constructor(private readonly view: EditorView) {
    this.cm = getCM(view);
    if (!this.cm) return;
    this.releaseDialogs = adoptVimDialogs(view, this.cm, (update) =>
      this.publish(update),
    );
    this.cm.on("vim-mode-change", this.onModeChange);
    this.cm.on("vim-command-done", this.onActivity);
    this.cm.on("vim-keypress", this.onActivity);
    this.cm.on("dialog", this.onActivity);
    const { initialMode } = view.state.facet(vimConfig);
    queueMicrotask(() => {
      if (this.destroyed || !this.cm) return;
      view.setTabFocusMode(this.mode !== "insert");
      if (initialMode === "insert" && !this.cm.state.vim?.insertMode)
        Vim.handleKey(this.cm, "i", "user");
      if (!this.publish()) {
        const status = vimStatusOf(view.state);
        if (status) view.state.facet(vimConfig).onStatus?.(status);
      }
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) this.publish();
    });
  }

  private visualCursor(
    state: NonNullable<VimAdapter["state"]["vim"]>,
  ): number | null {
    if (!this.cm || !state.visualMode || !state.sel) return null;
    return this.cm.indexFromPos(state.sel.head);
  }

  publish(extra: VimStatusUpdate = {}): boolean {
    const state = this.cm?.state.vim;
    const current = vimStatusOf(this.view.state);
    if (!state || !current) return false;
    const macro = Vim.getVimGlobalState_().macroModeState;
    const update: VimStatusUpdate = {
      mode: this.mode,
      cursor: this.visualCursor(state),
      pendingKeys: state.status ?? "",
      recording: macro.isRecording ? (macro.latestRegister ?? null) : null,
      ...extra,
    };
    if (sameStatus(current, update)) return false;
    this.view.dispatch({ effects: setVimStatus.of(update) });
    return true;
  }

  update(update: ViewUpdate): void {
    if (
      update.startState.facet(vimConfig) !== update.state.facet(vimConfig) ||
      ((update.selectionSet || update.docChanged) &&
        this.cm?.state.vim?.visualMode)
    )
      this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    this.releaseDialogs?.();
    if (this.cm) {
      this.cm.off("vim-mode-change", this.onModeChange);
      this.cm.off("vim-command-done", this.onActivity);
      this.cm.off("vim-keypress", this.onActivity);
      this.cm.off("dialog", this.onActivity);
    }
    this.view.setTabFocusMode(false);
  }
}

const vimSession = ViewPlugin.fromClass(VimSession);

function inPlainInsert(cm: VimAdapter): boolean {
  return Boolean(cm.state.vim?.insertMode && !cm.state.overwrite);
}

function isFormatChord(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || event.metaKey || event.altKey || CodeMirror.isMac)
    return false;
  const key = event.key.toLowerCase();
  return event.shiftKey
    ? key === "x"
    : key === "b" || key === "i" || key === "k";
}

const keyPolicy = ViewPlugin.define(() => ({}), {
  eventHandlers: {
    keydown(event, view) {
      const cm = getCM(view);
      if (!cm || !inPlainInsert(cm) || !isFormatChord(event)) return false;
      return runScopeHandlers(view, event, "editor");
    },
  },
});

const textInputGuard = EditorView.inputHandler.of((view) => {
  const cm = getCM(view);
  const state = cm?.state.vim;
  if (!cm || !state || state.insertMode || cm.curOp?.isVimOp) return false;
  return !(state.expectLiteralNext && view.composing);
});

const statusListener = EditorView.updateListener.of((update) => {
  const status = vimStatusOf(update.state);
  if (status && status !== vimStatusOf(update.startState))
    update.state.facet(vimConfig).onStatus?.(status);
});

const caretAttributes = EditorView.editorAttributes.compute(
  [vimStatusField, vimConfig],
  (state): Record<string, string> => {
    const { mode } = state.field(vimStatusField);
    if (mode === "replace") return { class: REPLACE_CLASS };
    return !state.facet(vimConfig).animatedCaret && mode === "insert"
      ? { class: PLAIN_CARET_CLASS }
      : {};
  },
);

const FAT_CURSOR = "> .cm-scroller > .cm-vimCursorLayer .cm-fat-cursor";
const SELECTION =
  "&.cm-editor > .cm-scroller > .cm-selectionLayer .cm-selectionBackground";

const vimTheme = Prec.highest(
  EditorView.theme({
    ".cm-vim-panel": { display: "none !important" },
    "&.cm-editor > .cm-scroller > .cm-content": {
      paddingLeft: "0",
      paddingRight: "0",
      marginLeft: "var(--space-4)",
      marginRight: "var(--space-4)",
    },
    "& > .cm-panels-bottom": { borderTop: "none" },
    ".cm-cursorLayer:not(.cm-vimCursorLayer) .cm-cursor": {
      display: "none !important",
    },
    [`&.${PLAIN_CARET_CLASS}.cm-focused > .cm-scroller > .cm-cursorLayer:not(.cm-vimCursorLayer) .cm-cursor`]:
      {
        display: "block !important",
        borderLeft: "2px solid var(--color-text)",
        marginLeft: "-1px",
      },
    "& > .cm-scroller > .cm-vimCursorLayer": { animation: "none !important" },
    [`& ${FAT_CURSOR}`]: {
      background: "var(--color-accent)",
      color: "var(--color-on-accent) !important",
      borderRadius: "0",
      outline: "none",
    },
    [`&:not(.cm-focused) ${FAT_CURSOR}`]: {
      background: "transparent",
      outline: "1px solid var(--color-accent)",
      color: "var(--color-text) !important",
    },
    [`&.cm-editor:not(.${REPLACE_CLASS}) ${FAT_CURSOR}[style*="color: transparent"]`]:
      { color: "transparent !important" },
    [`&.${REPLACE_CLASS} ${FAT_CURSOR}`]: {
      height: "auto !important",
      lineHeight: "normal !important",
      transform: "translateY(-80%)",
    },
    [`${SELECTION}, &.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`]:
      { background: "var(--color-selection)" },
    "&.cm-editor .cm-searchMatch": {
      backgroundColor: "var(--color-vim-mode-wash)",
      boxShadow: "inset 0 -2px 0 var(--color-accent)",
      color: "var(--color-text)",
    },
    "@media (forced-colors: active)": {
      ".cm-searchMatch": {
        forcedColorAdjust: "none",
        boxShadow: "none",
        backgroundColor: "Mark",
        color: "MarkText",
      },
      ".cm-vimCursorLayer .cm-fat-cursor": {
        forcedColorAdjust: "none",
        background: "Highlight !important",
        color: "HighlightText !important",
      },
      ".cm-content:not(:focus) ~ .cm-vimCursorLayer .cm-fat-cursor": {
        background: "transparent !important",
        outline: "1px solid Highlight",
        color: "CanvasText !important",
      },
      ".cm-selectionLayer .cm-selectionBackground": {
        background: "Highlight !important",
      },
    },
  }),
);

let insertCopyUnmapped = false;

function leaveInsertCopyToBrowser(): void {
  if (insertCopyUnmapped) return;
  insertCopyUnmapped = true;
  Vim.unmap("<C-c>", "insert");
}

const staticExtensions: Extension = [
  vimTheme,
  Prec.highest(keyPolicy),
  Prec.high(vim()),
  drawSelection(),
  textInputGuard,
  vimStatusField,
  vimSession,
  statusListener,
  caretAttributes,
  relativeLineNumbers(),
];

export function vimExtension(options: VimExtensionOptions): Extension {
  leaveInsertCopyToBrowser();
  useSystemClipboard();
  defineAppExCommands();
  const { initialMode, animatedCaret, onWrite, onQuit, onStatus } = options;
  return [
    vimConfig.of({ initialMode, animatedCaret, onStatus }),
    vimCallbacks.of({ onWrite, onQuit }),
    initialEditingMode.of(initialMode),
    staticExtensions,
  ];
}

export function resetEditingMode(
  view: EditorView,
  mode: "normal" | "insert",
): void {
  const cm = getCM(view);
  const state = cm?.state.vim;
  if (!cm || !state) return;
  const settled =
    mode === "insert" &&
    inPlainInsert(cm) &&
    state.inputState.keyBuffer.length === 0;
  if (!settled) Vim.handleKey(cm, "<Esc>", "user");
  if (mode === "insert" && !cm.state.vim?.insertMode)
    Vim.handleKey(cm, "i", "user");
  const vimState = cm.state.vim;
  if (vimState) vimState.status = "";
  discardCommandLine(view);
  view.plugin(vimSession)?.publish({ message: null, commandLine: null });
}

export function vimEscape(view: EditorView): void {
  const cm = getCM(view);
  if (cm) Vim.handleKey(cm, "<Esc>", "user");
  view.focus();
}

export function vimEnterInsert(view: EditorView): void {
  resetEditingMode(view, "insert");
  view.focus();
}
