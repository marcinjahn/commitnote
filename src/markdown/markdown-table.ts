import type { SyntaxNode } from "@lezer/common";

export type TableAlignment = "left" | "center" | "right" | "";

export interface MarkdownTableCell {
  readonly from: number;
  readonly to: number;
  readonly node: SyntaxNode | null;
}

export interface MarkdownTableRow {
  readonly from: number;
  readonly to: number;
  readonly cells: readonly MarkdownTableCell[];
}

export interface MarkdownTable {
  readonly from: number;
  readonly to: number;
  readonly alignments: readonly TableAlignment[];
  readonly header: MarkdownTableRow;
  readonly rows: readonly MarkdownTableRow[];
}

function parseAlignments(separator: string): TableAlignment[] {
  return separator
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => {
      const spec = cell.trim();
      const left = spec.startsWith(":");
      const right = spec.endsWith(":");
      if (left && right) return "center";
      if (left) return "left";
      if (right) return "right";
      return "";
    });
}

function rowSegments(row: SyntaxNode): Array<[number, number]> {
  const delimiters = row.getChildren("TableDelimiter");
  const segments: Array<[number, number]> = [];
  let start = row.from;
  for (const delimiter of delimiters) {
    segments.push([start, delimiter.from]);
    start = delimiter.to;
  }
  segments.push([start, row.to]);
  if (delimiters[0]?.from === row.from) segments.shift();
  if (delimiters[delimiters.length - 1]?.to === row.to) segments.pop();
  return segments;
}

function readRow(row: SyntaxNode, columns: number): MarkdownTableRow {
  const nodes = row.getChildren("TableCell");
  const cells: MarkdownTableCell[] = [];
  for (const [from, to] of rowSegments(row).slice(0, columns)) {
    const node = nodes.find((cell) => cell.from >= from && cell.to <= to);
    cells.push(
      node ? { from: node.from, to: node.to, node } : { from, to, node: null },
    );
  }
  while (cells.length < columns) {
    cells.push({ from: row.to, to: row.to, node: null });
  }
  return { from: row.from, to: row.to, cells };
}

export function readTable(
  node: SyntaxNode,
  text: string,
): MarkdownTable | null {
  const header = node.getChild("TableHeader");
  if (!header) return null;
  const columns = rowSegments(header).length;
  const separator = node.getChild("TableDelimiter");
  const alignments: TableAlignment[] = separator
    ? parseAlignments(text.slice(separator.from, separator.to))
    : [];
  alignments.length = Math.min(alignments.length, columns);
  while (alignments.length < columns) alignments.push("");
  return {
    from: node.from,
    to: node.to,
    alignments,
    header: readRow(header, columns),
    rows: node.getChildren("TableRow").map((row) => readRow(row, columns)),
  };
}
