import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "./markdown-parser";
import {
  pipeSegments,
  tableContainerPrefix,
  type TableAlignment,
} from "./markdown-table";

export interface SourceCell {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly text: string;
}

export interface SourceLine {
  readonly from: number;
  readonly to: number;
  readonly rowFrom: number;
  readonly lead: string;
  readonly cells: readonly SourceCell[];
  readonly leadingPipe: boolean;
  readonly trailingPipe: boolean;
}

export interface TableSource {
  readonly from: number;
  readonly to: number;
  readonly prefix: string | null;
  readonly columnCount: number;
  readonly alignments: readonly TableAlignment[];
  readonly lines: readonly SourceLine[];
}

export interface TableGrid {
  readonly alignments: readonly TableAlignment[];
  readonly header: {
    readonly lead: string;
    readonly cells: readonly string[];
  };
  readonly delimiterLead: string;
  readonly body: readonly {
    readonly lead: string;
    readonly cells: readonly string[];
  }[];
}

interface Span {
  readonly from: number;
  readonly to: number;
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(text: string, position: number): number {
  const end = text.indexOf("\n", position);
  return end < 0 ? text.length : end;
}

function isBlank(char: string): boolean {
  return char === " " || char === "\t";
}

function lineNodes(table: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (
      child.name === "TableHeader" ||
      child.name === "TableDelimiter" ||
      child.name === "TableRow"
    ) {
      nodes.push(child);
    }
  }
  return nodes;
}

function tableSpan(text: string, nodes: readonly SyntaxNode[]): Span {
  return {
    from: lineStart(text, nodes[0].from),
    to: lineEnd(text, nodes[nodes.length - 1].from),
  };
}

function forEachTable(
  text: string,
  visit: (table: SyntaxNode, lines: SyntaxNode[], span: Span) => boolean,
): void {
  let done = false;
  markdownParser.parse(text).iterate({
    enter(ref) {
      if (done) return false;
      if (ref.name !== "Table") return true;
      const lines = lineNodes(ref.node);
      if (lines.length > 0)
        done = visit(ref.node, lines, tableSpan(text, lines));
      return false;
    },
  });
}

function sourceCell(text: string, from: number, to: number): SourceCell {
  let contentTo = to;
  while (contentTo > from && isBlank(text[contentTo - 1])) contentTo--;
  let contentFrom = from;
  while (contentFrom < contentTo && isBlank(text[contentFrom])) contentFrom++;
  return {
    from,
    to,
    contentFrom,
    contentTo,
    text: text.slice(contentFrom, contentTo),
  };
}

function delimiterPipes(text: string, from: number, to: number): Span[] {
  const pipes: Span[] = [];
  for (let index = from; index < to; index++) {
    if (text[index] === "|") pipes.push({ from: index, to: index + 1 });
  }
  return pipes;
}

function sourceLine(text: string, node: SyntaxNode): SourceLine {
  const rowFrom = node.from;
  const rowTo = node.to;
  const pipes =
    node.name === "TableDelimiter"
      ? delimiterPipes(text, rowFrom, rowTo)
      : node.getChildren("TableDelimiter");
  const segments = pipeSegments(rowFrom, rowTo, pipes);
  const lastPipe = pipes[pipes.length - 1];
  let trailingPipe = lastPipe?.to === rowTo;
  const lastSegment = segments[segments.length - 1];
  if (
    !trailingPipe &&
    lastPipe &&
    lastSegment?.[0] === lastPipe.to &&
    text.slice(lastSegment[0], lastSegment[1]).trim() === ""
  ) {
    segments.pop();
    trailingPipe = true;
  }
  const from = lineStart(text, rowFrom);
  return {
    from,
    to: lineEnd(text, rowFrom),
    rowFrom,
    lead: text.slice(from, rowFrom),
    cells: segments.map(([start, end]) => sourceCell(text, start, end)),
    leadingPipe: pipes[0]?.from === rowFrom,
    trailingPipe,
  };
}

function alignment(spec: string): TableAlignment {
  const left = spec.startsWith(":");
  const right = spec.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "";
}

function readSource(
  text: string,
  table: SyntaxNode,
  nodes: readonly SyntaxNode[],
  span: Span,
): TableSource {
  const lines = nodes.map((node) => sourceLine(text, node));
  const columnCount = lines[0].cells.length;
  const alignments: TableAlignment[] = [];
  for (let column = 0; column < columnCount; column++) {
    const spec = lines[1]?.cells[column]?.text;
    alignments.push(spec === undefined ? "" : alignment(spec));
  }
  return {
    from: span.from,
    to: span.to,
    prefix: tableContainerPrefix(table, text),
    columnCount,
    alignments,
    lines,
  };
}

export function tableSourceAt(
  text: string,
  position: number,
): TableSource | null {
  let found: TableSource | null = null;
  forEachTable(text, (table, nodes, span) => {
    if (position < span.from || position > span.to) return false;
    found = readSource(text, table, nodes, span);
    return true;
  });
  return found;
}

export function tableSpans(text: string): readonly Span[] {
  const spans: Span[] = [];
  forEachTable(text, (_table, _nodes, span) => {
    spans.push(span);
    return false;
  });
  return spans;
}

export function cellAt(
  table: TableSource,
  position: number,
): { line: number; column: number; offset: number } {
  let line = table.lines.findIndex((candidate) => position <= candidate.to);
  if (line < 0) line = table.lines.length - 1;
  const cells = table.lines[line].cells;
  let column = cells.findIndex((cell) => position <= cell.to);
  if (column < 0) column = Math.max(cells.length - 1, 0);
  column = Math.max(Math.min(column, table.columnCount - 1), 0);
  const cell = cells[column];
  const offset = cell
    ? Math.min(Math.max(position - cell.contentFrom, 0), cell.text.length)
    : 0;
  return { line, column, offset };
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export function graphemeLength(text: string): number {
  return [...graphemes.segment(text)].length;
}

export function tableGrid(table: TableSource): TableGrid {
  const [header, delimiter, ...body] = table.lines;
  return {
    alignments: table.alignments,
    header: {
      lead: header.lead,
      cells: header.cells.map((cell) => cell.text),
    },
    delimiterLead: delimiter.lead,
    body: body.map((line) => {
      const cells = line.cells.map((cell) => cell.text);
      while (cells.length < table.columnCount) cells.push("");
      while (
        cells.length > table.columnCount &&
        cells[cells.length - 1] === ""
      ) {
        cells.pop();
      }
      return { lead: line.lead, cells };
    }),
  };
}

function delimiterCell(alignment: TableAlignment, width: number): string {
  switch (alignment) {
    case "left":
      return ":" + "-".repeat(width - 1);
    case "right":
      return "-".repeat(width - 1) + ":";
    case "center":
      return ":" + "-".repeat(width - 2) + ":";
    default:
      return "-".repeat(width);
  }
}

export function renderTableGrid(grid: TableGrid): {
  text: string;
  cellStarts: number[][];
} {
  const columnCount = grid.header.cells.length;
  const widths: number[] = [];
  for (let column = 0; column < columnCount; column++) {
    let width = Math.max(3, graphemeLength(grid.header.cells[column]));
    for (const row of grid.body) {
      width = Math.max(width, graphemeLength(row.cells[column] ?? ""));
    }
    widths.push(width);
  }

  let text = "";
  const cellStarts: number[][] = [];
  const addLine = (lead: string, cells: readonly string[]) => {
    if (cellStarts.length > 0) text += "\n";
    text += lead + "|";
    const starts: number[] = [];
    cells.forEach((cell, column) => {
      text += " ";
      if (column < columnCount) {
        starts.push(text.length);
        const padding = widths[column] - graphemeLength(cell);
        text += cell + " ".repeat(Math.max(padding, 0));
      } else {
        text += cell;
      }
      text += " |";
    });
    cellStarts.push(starts);
  };

  addLine(grid.header.lead, grid.header.cells);
  addLine(
    grid.delimiterLead,
    widths.map((width, column) =>
      delimiterCell(grid.alignments[column] ?? "", width),
    ),
  );
  for (const row of grid.body) {
    const cells = [...row.cells];
    while (cells.length < columnCount) cells.push("");
    addLine(row.lead, cells);
  }
  return { text, cellStarts };
}
