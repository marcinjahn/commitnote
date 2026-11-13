import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { inputKindAttributes, type InputKind } from "../input-kind/input-kind";
import { isVerbatimPosition } from "./verbatim-syntax";
import { editingModeOf } from "./vim/vim-status";

export function editorInputKind(state: EditorState): InputKind {
  if (state.readOnly || !state.facet(EditorView.editable)) return "verbatim";
  const mode = editingModeOf(state);
  if (mode !== null && mode !== "insert") return "verbatim";
  return isVerbatimPosition(state, state.selection.main.head)
    ? "verbatim"
    : "prose";
}

class AppliedInputKind {
  kind: InputKind;

  constructor(view: EditorView) {
    this.kind = editorInputKind(view.state);
  }

  // Keyboards restart or drop the word being composed when these
  // attributes change under them, so the kind holds until composition ends.
  update(update: ViewUpdate): void {
    if (!update.view.composing) this.kind = editorInputKind(update.state);
  }
}

export function editorInputKindAttributes(): Extension {
  const plugin = ViewPlugin.fromClass(AppliedInputKind, {
    eventHandlers: {
      compositionend(_event, view) {
        setTimeout(() => {
          if (
            view.plugin(plugin) === this &&
            !view.composing &&
            this.kind !== editorInputKind(view.state)
          )
            view.dispatch({});
        });
      },
    },
  });

  return [
    plugin,
    EditorView.contentAttributes.of((view) => ({
      ...inputKindAttributes(
        view.plugin(plugin)?.kind ?? editorInputKind(view.state),
      ),
      writingsuggestions: "false",
      translate: "no",
    })),
  ];
}
