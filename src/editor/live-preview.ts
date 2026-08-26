import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  HighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Tree } from "@lezer/common";

const TASK_LINE_CLASS = "cm-task-line";
const QUOTE_LINE_CLASS = "cm-quote-line";
const CODE_BLOCK_LINE_CLASS = "cm-code-block-line";

const livePreviewHighlightStyle = HighlightStyle.define([
  {
    tag: tags.heading1,
    fontSize: "var(--font-size-xl)",
    fontWeight: "var(--font-weight-semibold)",
    letterSpacing: "var(--letter-spacing-tighter)",
  },
  {
    tag: tags.heading2,
    fontSize: "var(--font-size-lg)",
    fontWeight: "var(--font-weight-semibold)",
    letterSpacing: "var(--letter-spacing-tight)",
  },
  {
    tag: tags.heading3,
    fontSize: "calc(var(--font-size-base) * 1.125)",
    fontWeight: "var(--font-weight-semibold)",
    letterSpacing: "var(--letter-spacing-tight)",
  },
  {
    tag: [tags.heading4, tags.heading5, tags.heading6],
    fontWeight: "var(--font-weight-semibold)",
  },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "var(--font-weight-semibold)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.875em",
    backgroundColor: "var(--color-code-surface)",
    padding: "0.1em 0.3em",
  },
  {
    tag: tags.link,
    color: "var(--color-link)",
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
  },
  { tag: tags.url, color: "var(--color-text-muted)" },
  { tag: tags.quote, color: "var(--color-text-muted)" },
  {
    // ListMark, HeaderMark, QuoteMark, LinkMark, EmphasisMark and CodeMark all
    // carry this tag; tags.list is deliberately not included here since it is
    // inherited by all text inside a list, not just its markers.
    tag: [tags.processingInstruction, tags.contentSeparator],
    color: "var(--color-text-muted)",
  },
]);

const livePreviewBaseTheme = EditorView.baseTheme({
  [`.${QUOTE_LINE_CLASS}`]: {
    borderLeft: "var(--hairline) solid var(--color-border-strong)",
    paddingLeft: "var(--space-3)",
    color: "var(--color-text-muted)",
  },
  [`.${CODE_BLOCK_LINE_CLASS}`]: {
    backgroundColor: "var(--color-code-surface)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.875em",
  },
  [`.${CODE_BLOCK_LINE_CLASS} *`]: {
    fontSize: "inherit",
  },
  [`.${TASK_LINE_CLASS}`]: {
    paddingTop: "calc(var(--space-2) + var(--space-1))",
    paddingBottom: "calc(var(--space-2) + var(--space-1))",
  },
  ".cm-task-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "middle",
  },
  ".cm-task-checkbox input": {
    width: "var(--checkbox-size)",
    height: "var(--checkbox-size)",
    cursor: "pointer",
  },
  ".cm-hr-widget": {
    display: "block",
    height: "0",
    margin: "var(--space-3) 0",
    borderTop: "var(--hairline) solid var(--color-border)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--color-selection)",
  },
});

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly checked: boolean,
  ) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return (
      other.from === this.from &&
      other.to === this.to &&
      other.checked === this.checked
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-task-checkbox";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", "Toggle task");

    const toggle = (): void => {
      if (view.state.readOnly) return;
      const from = this.resolveMarkerStart(view, wrapper);
      if (from === null) return;
      const isChecked = markerState(view.state, from) === "checked";
      view.dispatch({
        changes: { from, to: from + 3, insert: isChecked ? "[ ]" : "[x]" },
        userEvent: "input",
      });
    };

    input.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      toggle();
    });
    // Preventing touchstart suppresses the emulated mouse events, focus change and mobile keyboard.
    input.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        toggle();
      },
      { passive: false },
    );
    input.addEventListener("click", (event) => {
      event.preventDefault();
    });

    wrapper.appendChild(input);
    return wrapper;
  }

  private resolveMarkerStart(
    view: EditorView,
    wrapper: HTMLElement,
  ): number | null {
    let pos: number | null = null;
    try {
      pos = view.posAtDOM(wrapper);
    } catch {
      pos = null;
    }
    if (pos !== null && markerState(view.state, pos) !== null) return pos;
    if (
      this.to - this.from === 3 &&
      markerState(view.state, this.from) !== null
    ) {
      return this.from;
    }
    return null;
  }
}

function markerState(
  state: EditorState,
  from: number,
): "checked" | "unchecked" | null {
  if (from < 0 || from + 3 > state.doc.length) return null;
  const text = state.doc.sliceString(from, from + 3);
  if (text === "[ ]") return "unchecked";
  if (text === "[x]" || text === "[X]") return "checked";
  return null;
}

class HorizontalRuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const hr = document.createElement("span");
    hr.className = "cm-hr-widget";
    hr.setAttribute("aria-hidden", "true");
    return hr;
  }
}

function lineHasSelection(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const line = state.doc.lineAt(from);
  const end = state.doc.lineAt(to).to;
  return state.selection.ranges.some(
    (range) => range.from <= end && range.to >= line.from,
  );
}

function withTrailingSpace(
  state: EditorState,
  from: number,
  to: number,
): [number, number] {
  return state.doc.sliceString(to, to + 1) === " "
    ? [from, to + 1]
    : [from, to];
}

function addLineDecorations(
  decorations: Range<Decoration>[],
  state: EditorState,
  from: number,
  to: number,
  lineClass: string,
): void {
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  const deco = Decoration.line({ class: lineClass });
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    decorations.push(deco.range(state.doc.line(lineNumber).from));
  }
}

function collectLivePreviewDecorations(
  state: EditorState,
  tree: Tree,
): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  const ancestors: string[] = [];

  tree.iterate({
    enter(node) {
      const name = node.name;
      const parent = ancestors[ancestors.length - 1];
      ancestors.push(name);

      switch (name) {
        case "HeaderMark": {
          if (
            parent?.startsWith("ATXHeading") &&
            !lineHasSelection(state, node.from, node.to)
          ) {
            const [from, to] = withTrailingSpace(state, node.from, node.to);
            decorations.push(Decoration.replace({}).range(from, to));
          }
          break;
        }
        case "QuoteMark": {
          if (
            parent === "Blockquote" &&
            !lineHasSelection(state, node.from, node.to)
          ) {
            const [from, to] = withTrailingSpace(state, node.from, node.to);
            decorations.push(Decoration.replace({}).range(from, to));
          }
          break;
        }
        case "EmphasisMark":
        case "StrikethroughMark": {
          if (!lineHasSelection(state, node.from, node.to)) {
            decorations.push(Decoration.replace({}).range(node.from, node.to));
          }
          break;
        }
        case "CodeMark": {
          if (
            parent === "InlineCode" &&
            !lineHasSelection(state, node.from, node.to)
          ) {
            decorations.push(Decoration.replace({}).range(node.from, node.to));
          }
          // Fences inside FencedCode stay visible, just faded by the highlight style.
          break;
        }
        case "LinkMark":
        case "URL": {
          if (
            parent === "Link" &&
            !lineHasSelection(state, node.from, node.to)
          ) {
            decorations.push(Decoration.replace({}).range(node.from, node.to));
          }
          break;
        }
        case "TaskMarker": {
          const text = state.doc.sliceString(node.from, node.to);
          const checked = text[1] === "x" || text[1] === "X";
          decorations.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(node.from, node.to, checked),
            }).range(node.from, node.to),
          );
          decorations.push(
            Decoration.line({ class: TASK_LINE_CLASS }).range(
              state.doc.lineAt(node.from).from,
            ),
          );
          break;
        }
        case "HorizontalRule": {
          if (!lineHasSelection(state, node.from, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new HorizontalRuleWidget() }).range(
                node.from,
                node.to,
              ),
            );
          }
          break;
        }
        case "Blockquote": {
          addLineDecorations(
            decorations,
            state,
            node.from,
            node.to,
            QUOTE_LINE_CLASS,
          );
          break;
        }
        case "FencedCode": {
          addLineDecorations(
            decorations,
            state,
            node.from,
            node.to,
            CODE_BLOCK_LINE_CLASS,
          );
          break;
        }
        default:
          break;
      }
    },
    leave() {
      ancestors.pop();
    },
  });

  return decorations;
}

export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  return Decoration.set(collectLivePreviewDecorations(state, tree), true);
}

class LivePreviewPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildLivePreviewDecorations(view.state);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.decorations = buildLivePreviewDecorations(update.state);
    }
  }
}

export function livePreview(): Extension {
  return [
    syntaxHighlighting(livePreviewHighlightStyle),
    livePreviewBaseTheme,
    ViewPlugin.fromClass(LivePreviewPluginValue, {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
