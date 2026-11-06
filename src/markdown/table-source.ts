import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "./markdown-parser";
import { pipeSegments, tableContainerPrefix } from "./markdown-table";

export interface SourceCell {
  readonly from: number;
  readonly to: number;
  readonly contentTo: number;
  readonly text: string;
}

export interface SourceLine {
  readonly from: number;
  readonly to: number;
  readonly rowFrom: number;
  readonly cells: readonly SourceCell[];
  readonly trailingPipe: boolean;
}

export interface TableSource {
  readonly prefix: string | null;
  readonly columnCount: number;
  readonly lines: readonly SourceLine[];
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
    cells: segments.map(([start, end]) => sourceCell(text, start, end)),
    trailingPipe,
  };
}

function readSource(
  text: string,
  table: SyntaxNode,
  nodes: readonly SyntaxNode[],
): TableSource {
  const lines = nodes.map((node) => sourceLine(text, node));
  const columnCount = lines[0].cells.length;
  return {
    prefix: tableContainerPrefix(table, text),
    columnCount,
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
    found = readSource(text, table, nodes);
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
): { line: number; column: number } {
  let line = table.lines.findIndex((candidate) => position <= candidate.to);
  if (line < 0) line = table.lines.length - 1;
  const cells = table.lines[line].cells;
  let column = cells.findIndex((cell) => position <= cell.to);
  if (column < 0) column = Math.max(cells.length - 1, 0);
  column = Math.max(Math.min(column, table.columnCount - 1), 0);
  return { line, column };
}
