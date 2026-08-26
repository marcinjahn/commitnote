import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { CONFLICT_MARKERS } from "../merge/merge-text";

const conflictHighlightBaseTheme = EditorView.baseTheme({
  ".cm-conflict-marker": {
    backgroundColor: "var(--color-conflict-marker)",
    color: "var(--color-danger)",
    fontWeight: "var(--font-weight-semibold)",
  },
  ".cm-conflict-mine": {
    backgroundColor: "var(--color-conflict-mine)",
  },
  ".cm-conflict-theirs": {
    backgroundColor: "var(--color-conflict-theirs)",
  },
});

type ConflictRegion = "none" | "mine" | "theirs";

export function buildConflictDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  let region: ConflictRegion = "none";

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);

    if (line.text === CONFLICT_MARKERS.mine) {
      decorations.push(
        Decoration.line({ class: "cm-conflict-marker" }).range(line.from),
      );
      region = "mine";
    } else if (line.text === CONFLICT_MARKERS.separator) {
      decorations.push(
        Decoration.line({ class: "cm-conflict-marker" }).range(line.from),
      );
      region = region === "mine" ? "theirs" : "none";
    } else if (line.text === CONFLICT_MARKERS.theirs) {
      decorations.push(
        Decoration.line({ class: "cm-conflict-marker" }).range(line.from),
      );
      region = "none";
    } else if (region === "mine") {
      decorations.push(
        Decoration.line({ class: "cm-conflict-mine" }).range(line.from),
      );
    } else if (region === "theirs") {
      decorations.push(
        Decoration.line({ class: "cm-conflict-theirs" }).range(line.from),
      );
    }
  }

  return Decoration.set(decorations, true);
}

class ConflictHighlightPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildConflictDecorations(view.state);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.decorations = buildConflictDecorations(update.state);
    }
  }
}

export function conflictMarkerHighlight(): Extension {
  return [
    conflictHighlightBaseTheme,
    ViewPlugin.fromClass(ConflictHighlightPluginValue, {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
