import { insertBlock } from "./insertion-rule";
import type { TableAlignment } from "./markdown-table";
import {
  cellAt,
  renderTableGrid,
  tableGrid,
  tableSourceAt,
  tableSpans,
  type TableSource,
} from "./table-source";
import type { TextEdit, TextSelection } from "./text-edit";

export const TABLE_COMMANDS = [
  "insert-table",
  "insert-row-above",
  "insert-row-below",
  "insert-column-left",
  "insert-column-right",
  "delete-row",
  "delete-column",
  "align-column",
  "format-table",
  "next-cell",
  "previous-cell",
] as const;

export type TableCommand = (typeof TABLE_COMMANDS)[number];

export type ColumnAlignment = "left" | "center" | "right" | "default";

const NEW_TABLE = [
  "| Column 1 | Column 2 | Column 3 |",
  "| -------- | -------- | -------- |",
  "|          |          |          |",
  "|          |          |          |",
].join("\n");

const FIRST_HEADER = "Column 1";

const ALIGNMENTS: Readonly<Record<ColumnAlignment, TableAlignment>> = {
  left: "left",
  center: "center",
  right: "right",
  default: "",
};

interface Context {
  readonly table: TableSource;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

interface Grid {
  alignments: TableAlignment[];
  headerLead: string;
  header: string[];
  delimiterLead: string;
  body: { lead: string; cells: string[] }[];
}

type Target =
  | { readonly line: number; readonly column: number; readonly kind: "content" }
  | { readonly line: number; readonly column: number; readonly kind: "caret" }
  | {
      readonly line: number;
      readonly column: number;
      readonly kind: "offset";
      readonly offset: number;
    };

function contextAt(text: string, head: number): Context | null {
  const table = tableSourceAt(text, head);
  if (!table || table.prefix === null) return null;
  return { table, ...cellAt(table, head) };
}

function applies(command: TableCommand, context: Context | null): boolean {
  if (command === "insert-table") return true;
  if (!context) return false;
  switch (command) {
    case "insert-row-above":
    case "delete-row":
      return context.line >= 2;
    case "delete-column":
      return context.table.columnCount > 1;
    default:
      return true;
  }
}

function isColumnAlignment(value: unknown): value is ColumnAlignment {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ALIGNMENTS, value)
  );
}

function mutableGrid(table: TableSource): Grid {
  const grid = tableGrid(table);
  return {
    alignments: [...grid.alignments],
    headerLead: grid.header.lead,
    header: [...grid.header.cells],
    delimiterLead: grid.delimiterLead,
    body: grid.body.map((row) => ({ lead: row.lead, cells: [...row.cells] })),
  };
}

function emptyRow(grid: Grid): { lead: string; cells: string[] } {
  return { lead: grid.headerLead, cells: grid.header.map(() => "") };
}

function contentLength(
  rendered: string,
  start: number,
  grid: Grid,
  line: number,
  column: number,
): number {
  if (line === 0) return grid.header[column].length;
  if (line === 1) return /^[-:]*/.exec(rendered.slice(start))![0].length;
  return (grid.body[line - 2].cells[column] ?? "").length;
}

function formatEdit(
  text: string,
  table: TableSource,
  grid: Grid,
  target: Target,
): TextEdit {
  const rendered = renderTableGrid({
    alignments: grid.alignments,
    header: { lead: grid.headerLead, cells: grid.header },
    delimiterLead: grid.delimiterLead,
    body: grid.body,
  });
  const start = rendered.cellStarts[target.line][target.column];
  const anchor = table.from + start;
  let head = anchor;
  if (target.kind !== "caret") {
    const length = contentLength(
      rendered.text,
      start,
      grid,
      target.line,
      target.column,
    );
    head +=
      target.kind === "content" ? length : Math.min(target.offset, length);
  }
  const unchanged = rendered.text === text.slice(table.from, table.to);
  return {
    changes: unchanged
      ? []
      : [{ from: table.from, to: table.to, insert: rendered.text }],
    selection: { anchor: target.kind === "offset" ? head : anchor, head },
  };
}

function insertTable(text: string, head: number): TextEdit {
  const at = Math.min(Math.max(head, 0), text.length);
  const span = tableSpans(text).find(
    (candidate) => candidate.from <= at && at <= candidate.to,
  );
  let position: number;
  if (span) {
    position = span.to;
  } else {
    const from = text.lastIndexOf("\n", at - 1) + 1;
    const end = text.indexOf("\n", at);
    const to = end < 0 ? text.length : end;
    position = text.slice(from, to).trim() === "" ? from : to;
  }
  const edit = insertBlock(text, position, NEW_TABLE, "table");
  const tableStart = edit.selection.head - NEW_TABLE.length - 1;
  const anchor = tableStart + "| ".length;
  return {
    changes: edit.changes,
    selection: { anchor, head: anchor + FIRST_HEADER.length },
  };
}

function nextCellTarget(
  context: Context,
  grid: Grid,
): { line: number; column: number } {
  const { line, column, table } = context;
  if (column + 1 < table.columnCount) {
    return { line: line === 1 ? 0 : line, column: column + 1 };
  }
  const next = line <= 1 ? 2 : line + 1;
  if (next - 2 >= grid.body.length) grid.body.push(emptyRow(grid));
  return { line: next, column: 0 };
}

function previousCellTarget(
  context: Context,
): { line: number; column: number } | null {
  const { line, column, table } = context;
  if (column > 0) return { line: line === 1 ? 0 : line, column: column - 1 };
  if (line <= 1) return null;
  return { line: line === 2 ? 0 : line - 1, column: table.columnCount - 1 };
}

function run(
  text: string,
  selection: TextSelection,
  command: Exclude<TableCommand, "insert-table">,
  context: Context,
  alignment: TableAlignment,
): TextEdit {
  const { table, line, column, offset } = context;
  const grid = mutableGrid(table);
  const row = line === 1 ? 0 : line;
  const format = (target: Target) => formatEdit(text, table, grid, target);

  switch (command) {
    case "insert-row-above":
      grid.body.splice(line - 2, 0, emptyRow(grid));
      return format({ line, column, kind: "caret" });
    case "insert-row-below": {
      const index = row === 0 ? 0 : line - 1;
      grid.body.splice(index, 0, emptyRow(grid));
      return format({ line: index + 2, column, kind: "caret" });
    }
    case "insert-column-left":
    case "insert-column-right": {
      const at = command === "insert-column-left" ? column : column + 1;
      grid.alignments.splice(at, 0, "");
      grid.header.splice(at, 0, "");
      for (const body of grid.body) body.cells.splice(at, 0, "");
      return format({ line: row, column: at, kind: "caret" });
    }
    case "delete-row": {
      const index = line - 2;
      grid.body.splice(index, 1);
      const target = index < grid.body.length ? line : index > 0 ? line - 1 : 0;
      return format({ line: target, column, kind: "caret" });
    }
    case "delete-column": {
      grid.alignments.splice(column, 1);
      grid.header.splice(column, 1);
      for (const body of grid.body) body.cells.splice(column, 1);
      return format({
        line: row,
        column: Math.min(column, grid.header.length - 1),
        kind: "caret",
      });
    }
    case "align-column":
      grid.alignments[column] = alignment;
      return format({ line, column, kind: "offset", offset });
    case "format-table":
      return format({ line, column, kind: "offset", offset });
    case "next-cell":
      return format({ ...nextCellTarget(context, grid), kind: "content" });
    case "previous-cell": {
      const target = previousCellTarget(context);
      if (!target) return { changes: [], selection };
      return format({ ...target, kind: "content" });
    }
  }
}

export function applyTableCommand(
  text: string,
  selection: TextSelection,
  command: TableCommand,
  argument?: ColumnAlignment,
): TextEdit | null {
  if (command === "insert-table") return insertTable(text, selection.head);
  if (command === "align-column" && !isColumnAlignment(argument)) return null;
  const context = contextAt(text, selection.head);
  if (!context || !applies(command, context)) return null;
  return run(
    text,
    selection,
    command,
    context,
    ALIGNMENTS[argument ?? "default"],
  );
}

export function tableCommandAvailability(
  text: string,
  selection: TextSelection,
): Readonly<Record<TableCommand, boolean>> {
  const context = contextAt(text, selection.head);
  return Object.fromEntries(
    TABLE_COMMANDS.map((command) => [command, applies(command, context)]),
  ) as Record<TableCommand, boolean>;
}

export function availableTableCommands(
  text: string,
  selection: TextSelection,
): TableCommand[] {
  const availability = tableCommandAvailability(text, selection);
  return TABLE_COMMANDS.filter((command) => availability[command]);
}
