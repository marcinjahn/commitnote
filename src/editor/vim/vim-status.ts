import {
  Facet,
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
  readonly cursor: number | null;
  readonly pendingKeys: string;
  readonly recording: string | null;
  readonly message: VimMessage | null;
  readonly commandLine: CommandLineState | null;
}

export const initialEditingMode: Facet<VimEditingMode, VimEditingMode> =
  Facet.define<VimEditingMode, VimEditingMode>({
    combine: (values) => values[values.length - 1] ?? "normal",
  });

export type VimStatusUpdate = Partial<Omit<VimStatus, "line" | "column">>;

export const setVimStatus: StateEffectType<VimStatusUpdate> =
  StateEffect.define<VimStatusUpdate>();

function position(
  state: EditorState,
  cursor: number | null,
): Pick<VimStatus, "line" | "column"> {
  const head = Math.min(cursor ?? state.selection.main.head, state.doc.length);
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

export const vimStatusField = StateField.define<VimStatus>({
  create(state) {
    return {
      mode: state.facet(initialEditingMode),
      pendingKeys: "",
      recording: null,
      message: null,
      commandLine: null,
      cursor: null,
      ...position(state, null),
    };
  },
  update(value, tr) {
    let next = value;
    let moved = tr.docChanged || tr.selection !== undefined;
    for (const effect of tr.effects)
      if (effect.is(setVimStatus)) {
        next = { ...next, ...effect.value };
        if (effect.value.cursor !== undefined) moved = true;
      }
    if (moved) {
      const { line, column } = position(tr.state, next.cursor);
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
