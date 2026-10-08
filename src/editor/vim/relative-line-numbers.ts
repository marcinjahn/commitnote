import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

const CURRENT_CLASS = "cm-relative-line-current";
const HEADING_NODE = /^(?:ATXHeading|SetextHeading)([1-6])$/;

export function relativeLineLabel(line: number, cursorLine: number): string {
  return line === cursorLine
    ? String(line)
    : String(Math.abs(line - cursorLine));
}

class LineNumberMarker extends GutterMarker {
  constructor(
    private readonly label: string,
    private readonly classes: string,
  ) {
    super();
    this.elementClass = classes;
  }

  eq(other: GutterMarker): boolean {
    return (
      other instanceof LineNumberMarker &&
      other.label === this.label &&
      other.classes === this.classes
    );
  }

  toDOM(): Node {
    return document.createTextNode(this.label);
  }
}

function headingLevel(state: EditorState, from: number, to: number): number {
  let level = 0;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (level) return false;
      if (node.from < from || node.from > to) return;
      const match = HEADING_NODE.exec(node.name);
      if (match) {
        level = Number(match[1]);
        return false;
      }
    },
  });
  return level;
}

function spacerFor(state: EditorState): GutterMarker {
  const width = Math.max(2, String(state.doc.lines).length);
  return new LineNumberMarker("9".repeat(width), "");
}

const lineHeightOf = (fontSize: string) =>
  `calc(${fontSize} * var(--line-height))`;

const theme = EditorView.theme({
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
  },
  ".cm-relative-line-numbers .cm-gutterElement": {
    boxSizing: "border-box",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    lineHeight: lineHeightOf("var(--font-size-base)"),
    color: "var(--color-text-muted)",
    textAlign: "right",
    padding: "0 var(--space-2) 0 0",
  },
  [`.cm-relative-line-numbers .${CURRENT_CLASS}`]: {
    color: "var(--color-text)",
  },
  ".cm-relative-line-numbers .cm-relative-line-h1": {
    lineHeight: lineHeightOf("var(--font-size-xl)"),
  },
  ".cm-relative-line-numbers .cm-relative-line-h2": {
    lineHeight: lineHeightOf("var(--font-size-lg)"),
  },
  ".cm-relative-line-numbers .cm-relative-line-h3": {
    lineHeight: lineHeightOf("calc(var(--font-size-base) * 1.125)"),
  },
  "@media (forced-colors: active)": {
    ".cm-relative-line-numbers .cm-gutterElement": {
      color: "CanvasText",
    },
  },
});

export function relativeLineNumbers(): Extension {
  return [
    gutter({
      class: "cm-relative-line-numbers",
      lineMarker(view, block) {
        const { state } = view;
        const line = state.doc.lineAt(block.from);
        const cursorLine = state.doc.lineAt(state.selection.main.head).number;
        const classes: string[] = [];
        if (line.number === cursorLine) classes.push(CURRENT_CLASS);
        const level = headingLevel(state, line.from, line.to);
        if (level > 0) classes.push(`cm-relative-line-h${level}`);
        return new LineNumberMarker(
          relativeLineLabel(line.number, cursorLine),
          classes.join(" "),
        );
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state),
      initialSpacer: (view) => spacerFor(view.state),
      updateSpacer: (_spacer, update) => spacerFor(update.state),
    }),
    theme,
  ];
}
