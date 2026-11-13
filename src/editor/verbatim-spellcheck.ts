import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { inputKindAttributes } from "../input-kind/input-kind";
import { VERBATIM_NODE_NAMES } from "./verbatim-syntax";

const verbatimMark = Decoration.mark({
  attributes: { spellcheck: inputKindAttributes("verbatim").spellcheck },
});

function buildVerbatimMarks(view: EditorView): DecorationSet {
  const tree = syntaxTree(view.state);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!VERBATIM_NODE_NAMES.has(node.name)) return;
        if (node.from >= lastTo && node.to > node.from) {
          builder.add(node.from, node.to, verbatimMark);
          lastTo = node.to;
        }
        return false;
      },
    });
  }
  return builder.finish();
}

export function verbatimSpellcheck(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildVerbatimMarks(view);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = buildVerbatimMarks(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
