import {
  EditorSelection,
  type EditorState,
  type Extension,
  type Line,
  Prec,
  type Range,
  StateField,
} from "@codemirror/state";
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { readTable } from "../markdown/markdown-table";
import { lineHasSelection } from "./live-preview";
import { TableWidget, tableLinkOpener } from "./table-widget";

const CONTAINERS = new Set([
  "Document",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
]);

const sourceLine = Decoration.line({ class: "cm-table-source-line" });
const delimiterMark = Decoration.mark({ class: "cm-table-delimiter" });

function addTableSource(
  state: EditorState,
  node: SyntaxNode,
  decorations: Range<Decoration>[],
): void {
  const doc = state.doc;
  const last = doc.lineAt(node.to).number;
  for (let number = doc.lineAt(node.from).number; number <= last; number++) {
    decorations.push(sourceLine.range(doc.line(number).from));
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableDelimiter") {
      if (child.to > child.from) {
        decorations.push(delimiterMark.range(child.from, child.to));
      }
    } else if (child.name === "TableHeader" || child.name === "TableRow") {
      for (const pipe of child.getChildren("TableDelimiter")) {
        if (pipe.to > pipe.from) {
          decorations.push(delimiterMark.range(pipe.from, pipe.to));
        }
      }
    }
  }
}

function buildTableWidgetDecorations(state: EditorState): DecorationSet {
  const tree =
    ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const doc = state.doc;
  let text: string | null = null;
  const decorations: Range<Decoration>[] = [];

  tree.iterate({
    enter(ref) {
      if (CONTAINERS.has(ref.name)) return;
      if (ref.name !== "Table") return false;
      const node = ref.node;
      const touched =
        !state.readOnly && lineHasSelection(state, node.from, node.to);
      const table =
        node.parent?.name === "Document" && !touched
          ? readTable(node, (text ??= doc.toString()))
          : null;
      if (table) {
        const from = doc.lineAt(node.from).from;
        const to = doc.lineAt(node.to).to;
        decorations.push(
          Decoration.replace({
            widget: new TableWidget(
              doc.sliceString(from, to),
              table,
              from,
              state.readOnly,
            ),
            block: true,
          }).range(from, to),
        );
      } else {
        addTableSource(state, node, decorations);
      }
      return false;
    },
  });

  return Decoration.set(decorations, true);
}

export const tableWidgetsField = StateField.define<DecorationSet>({
  create: buildTableWidgetDecorations,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.state.readOnly !== tr.startState.readOnly ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildTableWidgetDecorations(tr.state);
    }
    if (tr.selection && !tr.state.selection.eq(tr.startState.selection)) {
      return value.size === 0 ? value : buildTableWidgetDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function tableEntryLine(
  state: EditorState,
  pos: number,
  forward: boolean,
): Line | null {
  if (state.readOnly) return null;
  const widgets = state.field(tableWidgetsField, false);
  if (!widgets) return null;
  const doc = state.doc;
  const line = doc.lineAt(pos);
  if (forward ? line.number >= doc.lines : line.number <= 1) return null;
  const edge = forward ? line.to + 1 : line.from - 1;
  let found = false;
  widgets.between(edge, edge, (from, to, deco) => {
    if (deco.spec.widget && (forward ? from === edge : to === edge)) {
      found = true;
      return false;
    }
  });
  return found ? doc.lineAt(edge) : null;
}

export function renderedTableInLines(
  state: EditorState,
  fromLine: number,
  toLine: number,
): boolean {
  const widgets = state.field(tableWidgetsField, false);
  if (!widgets) return false;
  const doc = state.doc;
  const first = Math.max(1, fromLine);
  const last = Math.min(doc.lines, toLine);
  if (first > last) return false;
  let found = false;
  widgets.between(doc.line(first).from, doc.line(last).to, (_f, _t, deco) => {
    if (deco.spec.widget) {
      found = true;
      return false;
    }
  });
  return found;
}

export function pageTargetInTable(
  view: EditorView,
  head: number,
  forward: boolean,
  distance: number,
): number | null {
  const { state } = view;
  if (state.readOnly) return null;
  const widgets = state.field(tableWidgetsField, false);
  if (!widgets) return null;
  const documentTop = view.documentTop;
  let start = view.coordsAtPos(head, forward ? 1 : -1);
  if (!start) {
    const line = view.lineBlockAt(head);
    start = {
      left: 0,
      right: 0,
      top: line.top + documentTop,
      bottom: line.bottom + documentTop,
    };
  }
  const y = forward ? start.bottom + distance : start.top - distance;
  const height = y - documentTop;
  const block = view.lineBlockAtHeight(height);
  if (height < block.top || height >= block.bottom) return null;
  let from = -1;
  let to = -1;
  widgets.between(block.from, block.to, (f, t, deco) => {
    if (deco.spec.widget) {
      from = f;
      to = t;
      return false;
    }
  });
  if (from < 0) return null;
  const doc = state.doc;
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  for (const table of view.contentDOM.querySelectorAll("table.cm-table")) {
    const pos = view.posAtDOM(table);
    if (pos < from || pos > to) continue;
    const rows = [...table.querySelectorAll("tr")];
    const hit = rows.findIndex((row) => row.getBoundingClientRect().bottom > y);
    const index = hit === -1 ? Math.max(0, rows.length - 1) : hit;
    return index === 0 ? first : Math.min(first + 1 + index, last);
  }
  return forward ? first : last;
}

function enterTable(forward: boolean): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.selection.ranges.length > 1 || !range.empty) return false;
    const target = tableEntryLine(state, range.head, forward);
    if (!target) return false;
    const current = state.doc.lineAt(range.head);
    const moved = view.moveVertically(range, forward);
    if (moved.head >= current.from && moved.head <= current.to) return false;
    const column = range.head - current.from;
    view.dispatch({
      selection: { anchor: target.from + Math.min(column, target.length) },
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

export const enterTableDown = enterTable(true);
export const enterTableUp = enterTable(false);

function pageHeight(view: EditorView): number {
  const { scrollDOM } = view;
  let height: number;
  if (scrollDOM.clientHeight < scrollDOM.scrollHeight - 2) {
    let top = 0;
    let bottom = 0;
    for (const source of view.state.facet(EditorView.scrollMargins)) {
      const margins = source(view);
      if (margins?.top) top = Math.max(margins.top, top);
      if (margins?.bottom) bottom = Math.max(margins.bottom, bottom);
    }
    height = scrollDOM.clientHeight - top - bottom;
  } else {
    height = (view.dom.ownerDocument.defaultView ?? window).innerHeight;
  }
  return Math.max(view.defaultLineHeight, height - 5);
}

function pageIntoTable(forward: boolean): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.selection.ranges.length > 1 || !range.empty) return false;
    const line = pageTargetInTable(view, range.head, forward, pageHeight(view));
    if (line === null) return false;
    const { doc } = state;
    const target = doc.line(line);
    const column = range.head - doc.lineAt(range.head).from;
    view.dispatch({
      selection: EditorSelection.cursor(
        target.from + Math.min(column, target.length),
      ),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

const tableEntryKeymap = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: enterTableDown },
    { key: "ArrowUp", run: enterTableUp },
    { key: "PageDown", run: pageIntoTable(true) },
    { key: "PageUp", run: pageIntoTable(false) },
  ]),
);

const tableWidgetsTheme = EditorView.baseTheme({
  ".cm-table-widget": {
    padding: "var(--space-2) 0",
  },
  ".cm-table-scroller": {
    overflowX: "auto",
    maxWidth: "100%",
    overscrollBehaviorX: "contain",
    // Without it the table's min-content width widens .cm-content instead of scrolling here.
    contain: "inline-size",
  },
  ".cm-table-scroller:focus-visible": {
    outline: "2px solid var(--color-accent)",
    outlineOffset: "2px",
  },
  ".cm-table": {
    borderCollapse: "collapse",
    borderRadius: "0",
    width: "auto",
    fontFamily: "var(--font-note)",
    fontSize: "var(--font-size-base)",
  },
  ".cm-table th, .cm-table td": {
    border: "var(--hairline) solid var(--color-border)",
    padding: "var(--space-1) var(--space-2)",
    verticalAlign: "top",
    whiteSpace: "normal",
    // .cm-lineWrapping's word-break: break-word would shrink columns mid-word.
    wordBreak: "normal",
    overflowWrap: "break-word",
  },
  ".cm-table th": {
    fontWeight: "var(--font-weight-semibold)",
    textAlign: "start",
    borderBottom: "var(--hairline) solid var(--color-accent)",
  },
  ".cm-table code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875em",
    backgroundColor: "var(--color-code-surface)",
    padding: "0.1em 0.3em",
  },
  ".cm-table-link": {
    color: "var(--color-link)",
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
  },
  "&.cm-link-open-armed .cm-table-link": {
    cursor: "pointer",
  },
  ".cm-table-source-line": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875em",
  },
  ".cm-table-source-line *": {
    fontSize: "inherit",
  },
  ".cm-table-delimiter": {
    color: "var(--color-text-muted)",
  },
  "@media (forced-colors: active)": {
    ".cm-table th, .cm-table td": {
      borderColor: "CanvasText",
    },
  },
});

export function tableWidgets(
  options: { open?: (url: string) => void } = {},
): Extension {
  const extensions: Extension[] = [
    tableWidgetsField,
    tableEntryKeymap,
    tableWidgetsTheme,
  ];
  if (options.open) extensions.push(tableLinkOpener.of(options.open));
  return extensions;
}
