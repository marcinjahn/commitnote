import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  gutter,
} from "@codemirror/view";
import { TableWidget, tableRowTextTops } from "../table-widget";

const CURRENT_CLASS = "cm-relative-line-current";
const TABLE_LINES_CLASS = "cm-table-line-numbers";
const TABLE_LINES_ALIGNED_CLASS = "cm-table-line-numbers-aligned";
const TABLE_LINE_CLASS = "cm-table-line-number";
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

interface TableLineLabel {
  readonly label: string;
  readonly current: boolean;
}

class TableLineNumbersMarker extends GutterMarker {
  constructor(
    private readonly firstLine: number,
    private readonly lines: readonly TableLineLabel[],
  ) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return (
      other instanceof TableLineNumbersMarker &&
      other.firstLine === this.firstLine &&
      other.lines.length === this.lines.length &&
      other.lines.every(
        (line, i) =>
          line.label === this.lines[i].label &&
          line.current === this.lines[i].current,
      )
    );
  }

  toDOM(): Node {
    const container = document.createElement("div");
    container.className = TABLE_LINES_CLASS;
    container.dataset.firstLine = String(this.firstLine);
    for (const { label, current } of this.lines) {
      const element = document.createElement("div");
      element.className = current
        ? `${TABLE_LINE_CLASS} ${CURRENT_CLASS}`
        : TABLE_LINE_CLASS;
      element.textContent = label;
      container.appendChild(element);
    }
    return container;
  }
}

export function alignTableLineNumbers(
  rowTops: readonly number[],
  lineCount: number,
  labelHeight: number,
): number[] | null {
  if (lineCount < 2 || rowTops.length !== lineCount - 1) return null;
  const tops = [rowTops[0], rowTops[0] + labelHeight];
  for (let k = 2; k < lineCount; k++) {
    tops.push(Math.max(rowTops[k - 1], tops[k - 1] + labelHeight));
  }
  return tops;
}

interface TableLinePlacement {
  readonly container: HTMLElement;
  readonly tops: number[] | null;
}

// A label box is a full gutter line, nearly as tall as a one-line table row, so
// spacing labels by their boxes would push the delimiter onto the first body
// row. Spacing by the text keeps the digits apart without that drift.
function labelTextHeight(label: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(label);
  return range.getBoundingClientRect().height;
}

function measureTableLineNumbers(view: EditorView): TableLinePlacement[] {
  const rowTopsByLine = new Map<number, number[]>();
  for (const wrapper of view.contentDOM.querySelectorAll<HTMLElement>(
    ".cm-table-widget",
  )) {
    let from: number;
    try {
      from = view.posAtDOM(wrapper);
    } catch {
      continue;
    }
    rowTopsByLine.set(
      view.state.doc.lineAt(from).number,
      tableRowTextTops(wrapper),
    );
  }

  const placements: TableLinePlacement[] = [];
  for (const container of view.dom.querySelectorAll<HTMLElement>(
    `.cm-relative-line-numbers .${TABLE_LINES_CLASS}`,
  )) {
    const rowTops = rowTopsByLine.get(Number(container.dataset.firstLine));
    const label = container.firstElementChild;
    if (!rowTops || !(label instanceof HTMLElement)) {
      placements.push({ container, tops: null });
      continue;
    }
    const top = container.getBoundingClientRect().top;
    placements.push({
      container,
      tops: alignTableLineNumbers(
        rowTops.map((rowTop) => (rowTop - top) / view.scaleY),
        container.childElementCount,
        labelTextHeight(label) / view.scaleY,
      ),
    });
  }
  return placements;
}

function placeTableLineNumbers(placements: TableLinePlacement[]): void {
  for (const { container, tops } of placements) {
    const labels = Array.from(container.children) as HTMLElement[];
    container.classList.toggle(TABLE_LINES_ALIGNED_CLASS, tops !== null);
    labels.forEach((label, i) => {
      label.style.top = tops ? `${tops[i]}px` : "";
    });
  }
}

const tableLineNumberAlignment = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.heightChanged
      )
        this.schedule();
    }

    private schedule(): void {
      this.view.requestMeasure({
        key: this,
        read: measureTableLineNumbers,
        write: placeTableLineNumbers,
      });
    }
  },
);

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

function lineHasNode(
  state: EditorState,
  from: number,
  to: number,
  name: string,
): boolean {
  let found = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (found) return false;
      if (node.name === name) {
        found = true;
        return false;
      }
    },
  });
  return found;
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
    color: "var(--color-link)",
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
  ".cm-relative-line-numbers .cm-relative-line-task": {
    paddingTop: "calc(var(--space-2) + var(--space-1))",
  },
  ".cm-relative-line-numbers .cm-relative-line-code": {
    lineHeight: lineHeightOf("calc(var(--font-size-base) * 0.875)"),
  },
  ".cm-relative-line-numbers .cm-relative-line-rule": {
    paddingTop: `calc(${lineHeightOf("var(--font-size-base)")} / 2 + var(--space-3))`,
  },
  [`.cm-relative-line-numbers .${TABLE_LINES_CLASS}`]: {
    height: "100%",
  },
  [`.cm-relative-line-numbers .${TABLE_LINES_ALIGNED_CLASS}`]: {
    position: "relative",
  },
  [`.cm-relative-line-numbers .${TABLE_LINE_CLASS}`]: {
    height: lineHeightOf("var(--font-size-base)"),
    lineHeight: lineHeightOf("var(--font-size-base)"),
    whiteSpace: "nowrap",
  },
  [`.cm-relative-line-numbers .${TABLE_LINES_ALIGNED_CLASS} .${TABLE_LINE_CLASS}`]:
    {
      position: "absolute",
      left: "0",
      right: "0",
    },
  "@media (max-width: 767px)": {
    ".cm-relative-line-numbers .cm-gutterElement": {
      paddingLeft: "var(--space-2)",
    },
  },
  "@media (forced-colors: active)": {
    ".cm-relative-line-numbers .cm-gutterElement": {
      color: "CanvasText",
    },
    [`.cm-relative-line-numbers .${CURRENT_CLASS}`]: {
      color: "Highlight",
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
        if (lineHasNode(state, line.from, line.to, "TaskMarker"))
          classes.push("cm-relative-line-task");
        if (
          lineHasNode(state, line.from, line.to, "HorizontalRule") &&
          !state.selection.ranges.some(
            (range) => range.from <= line.to && range.to >= line.from,
          )
        )
          classes.push("cm-relative-line-rule");
        if (lineHasNode(state, line.from, line.to, "FencedCode"))
          classes.push("cm-relative-line-code");
        return new LineNumberMarker(
          relativeLineLabel(line.number, cursorLine),
          classes.join(" "),
        );
      },
      widgetMarker(view, widget, block) {
        if (!(widget instanceof TableWidget)) return null;
        const { doc, selection } = view.state;
        const cursorLine = doc.lineAt(selection.main.head).number;
        const first = doc.lineAt(block.from).number;
        const last = doc.lineAt(block.to).number;
        const lines: TableLineLabel[] = [];
        for (let n = first; n <= last; n++) {
          lines.push({
            label: relativeLineLabel(n, cursorLine),
            current: n === cursorLine,
          });
        }
        return new TableLineNumbersMarker(first, lines);
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state),
      initialSpacer: (view) => spacerFor(view.state),
      updateSpacer: (_spacer, update) => spacerFor(update.state),
    }),
    tableLineNumberAlignment,
    theme,
  ];
}
