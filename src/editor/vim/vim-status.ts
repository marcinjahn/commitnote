import {
  StateEffect,
  StateField,
  type EditorState,
  type StateEffectType,
} from "@codemirror/state";

export type VimEditingMode =
  | "normal"
  | "insert"
  | "visual"
  | "visual-line"
  | "visual-block"
  | "replace";

export type CommandLineKind = ":" | "/" | "?";

export interface CommandLineState {
  readonly kind: CommandLineKind;
  readonly value: string;
}

export interface VimMessage {
  readonly text: string;
  readonly error: boolean;
  readonly id: number;
}

export interface VimStatus {
  readonly mode: VimEditingMode;
  readonly line: number;
  readonly column: number;
  readonly pendingKeys: string;
  readonly recording: string | null;
  readonly message: VimMessage | null;
  readonly commandLine: CommandLineState | null;
}

export type VimStatusUpdate = Partial<Omit<VimStatus, "line" | "column">>;

export const setVimStatus: StateEffectType<VimStatusUpdate> =
  StateEffect.define<VimStatusUpdate>();

function position(state: EditorState): Pick<VimStatus, "line" | "column"> {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

export const vimStatusField = StateField.define<VimStatus>({
  create(state) {
    return {
      mode: "normal",
      pendingKeys: "",
      recording: null,
      message: null,
      commandLine: null,
      ...position(state),
    };
  },
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects)
      if (effect.is(setVimStatus)) next = { ...next, ...effect.value };
    if (tr.docChanged || tr.selection) {
      const { line, column } = position(tr.state);
      if (line !== next.line || column !== next.column)
        next = { ...next, line, column };
    }
    return next;
  },
});

export function vimStatusOf(state: EditorState): VimStatus | null {
  return state.field(vimStatusField, false) ?? null;
}

export function editingModeOf(state: EditorState): VimEditingMode | null {
  return vimStatusOf(state)?.mode ?? null;
}
