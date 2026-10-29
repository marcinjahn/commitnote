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

export function tableContainerPrefix(
  node: SyntaxNode,
  text: string,
): string | null {
  if (node.name !== "Table") return null;
  if (!node.parent || node.parent.name === "Document") return "";
  const lines: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (
      child.name === "TableHeader" ||
      child.name === "TableDelimiter" ||
      child.name === "TableRow"
    ) {
      lines.push(child);
    }
  }
  if (lines.length !== text.slice(node.from, node.to).split("\n").length) {
    return null;
  }
  const prefixes = lines.map((line) =>
    text.slice(text.lastIndexOf("\n", line.from - 1) + 1, line.from),
  );
  const prefix = prefixes[0];
  if (prefix === undefined || prefixes.some((other) => other !== prefix)) {
    return null;
  }
  return /^[ \t>]*$/.test(prefix) ? prefix : null;
}

export function containerPrefixLayout(prefix: string): {
  quoteLevels: number;
  indent: string;
} {
  return {
    quoteLevels: prefix.split(">").length - 1,
    indent: prefix.replace(/>[ \t]?/g, ""),
  };
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

export function pipeSegments(
  from: number,
  to: number,
  pipes: readonly { readonly from: number; readonly to: number }[],
): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let start = from;
  for (const pipe of pipes) {
    segments.push([start, pipe.from]);
    start = pipe.to;
  }
  segments.push([start, to]);
  if (pipes[0]?.from === from) segments.shift();
  if (pipes[pipes.length - 1]?.to === to) segments.pop();
  return segments;
}

function rowSegments(row: SyntaxNode): Array<[number, number]> {
  return pipeSegments(row.from, row.to, row.getChildren("TableDelimiter"));
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
