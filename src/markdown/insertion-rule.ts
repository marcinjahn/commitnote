import type { TextEdit } from "./text-edit";
import {
  cellAt,
  tableSourceAt,
  tableSpans,
  type SourceLine,
  type TableSource,
} from "./table-source";

function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(text: string, position: number): number {
  const end = text.indexOf("\n", position);
  return end < 0 ? text.length : end;
}

function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

export function insertBlock(
  text: string,
  position: number,
  block: string,
  kind: "table" | "lines",
): TextEdit {
  let at = Math.min(Math.max(position, 0), text.length);
  let from = lineStart(text, at);
  let to = lineEnd(text, at);
  if (at === to && at !== from && to < text.length) {
    const nextTo = lineEnd(text, to + 1);
    if (isBlankLine(text.slice(to + 1, nextTo))) {
      at = to + 1;
      from = at;
      to = nextTo;
    }
  }
  const spans = tableSpans(text);

  let before = at !== from ? "\n" : "";
  if (at > 0) {
    const previousFrom = lineStart(text, at - 1);
    const previous = text.slice(previousFrom, at);
    const previousInTable = spans.some(
      (span) => span.from <= previousFrom && previousFrom <= span.to,
    );
    if (!isBlankLine(previous) && (kind === "table" || previousInTable)) {
      before += "\n";
    }
  }

  let after = "";
  if (!isBlankLine(text.slice(at, to))) {
    const startsTable = at === from && spans.some((span) => span.from === from);
    if (kind === "table" || startsTable) after = "\n";
  }

  const insert = before + block + "\n" + after;
  const caret = at + before.length + block.length + 1;
  return {
    changes: [{ from: at, to: at, insert }],
    selection: { anchor: caret, head: caret },
  };
}

function insertInline(
  text: string,
  position: number,
  references: readonly string[],
): TextEdit {
  const joined = references.join(" ");
  const previous = position > 0 ? text[position - 1] : "";
  const next = position < text.length ? text[position] : "";
  const lead = previous !== "" && !/\s/.test(previous) ? " " : "";
  const trail = next !== "" && !/\s/.test(next) ? " " : "";
  const caret = position + lead.length + joined.length;
  return {
    changes: [{ from: position, to: position, insert: lead + joined + trail }],
    selection: { anchor: caret, head: caret },
  };
}

function inlinePoint(
  table: TableSource,
  line: SourceLine,
  lineIndex: number,
  position: number,
): number {
  if (lineIndex === 1) {
    const { column } = cellAt(table, position);
    const header = table.lines[0].cells[column];
    return header.text !== ""
      ? header.contentTo
      : Math.min(header.from + 1, header.to);
  }
  const cells = line.cells;
  const clamped = Math.min(
    Math.max(position, cells[0].from),
    cells[cells.length - 1].to,
  );
  const cell = cells.find((candidate) => clamped <= candidate.to);
  return cell ? Math.max(clamped, cell.from) : clamped;
}

export function insertImageReferences(
  text: string,
  position: number,
  references: readonly string[],
): TextEdit {
  const at = Math.min(Math.max(position, 0), text.length);
  const block = references.join("\n");
  const table = tableSourceAt(text, at);
  if (!table) return insertBlock(text, at, block, "lines");

  const lineIndex = cellAt(table, at).line;
  const line = table.lines[lineIndex];
  if (lineIndex === 0 && at <= line.rowFrom) {
    return insertBlock(text, line.from, block, "lines");
  }
  if (lineIndex === table.lines.length - 1 && line.trailingPipe) {
    const pipeEnd = line.cells[line.cells.length - 1].to + 1;
    if (at >= pipeEnd) return insertBlock(text, line.to, block, "lines");
  }
  return insertInline(
    text,
    inlinePoint(table, line, lineIndex, at),
    references,
  );
}
