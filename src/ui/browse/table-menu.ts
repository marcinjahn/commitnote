import type {
  ColumnAlignment,
  TableCommand,
} from "../../markdown/table-commands";
import { tableMenuIcons } from "./action-icons";
import type { MenuItem } from "./row-menu-types";

export type TableMenuId =
  | "insert-table"
  | "insert-row-above"
  | "insert-row-below"
  | "insert-column-left"
  | "insert-column-right"
  | "delete-row"
  | "delete-column"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-default"
  | "format-table";

interface TableMenuEntry {
  readonly id: TableMenuId;
  readonly label: string;
  readonly command: TableCommand;
  readonly argument?: ColumnAlignment;
  readonly destructive?: boolean;
}

const ENTRIES: readonly TableMenuEntry[] = [
  { id: "insert-table", label: "Insert table", command: "insert-table" },
  {
    id: "insert-row-above",
    label: "Insert row above",
    command: "insert-row-above",
  },
  {
    id: "insert-row-below",
    label: "Insert row below",
    command: "insert-row-below",
  },
  {
    id: "insert-column-left",
    label: "Insert column left",
    command: "insert-column-left",
  },
  {
    id: "insert-column-right",
    label: "Insert column right",
    command: "insert-column-right",
  },
  {
    id: "delete-row",
    label: "Delete row",
    command: "delete-row",
    destructive: true,
  },
  {
    id: "delete-column",
    label: "Delete column",
    command: "delete-column",
    destructive: true,
  },
  {
    id: "align-left",
    label: "Align column left",
    command: "align-column",
    argument: "left",
  },
  {
    id: "align-center",
    label: "Align column center",
    command: "align-column",
    argument: "center",
  },
  {
    id: "align-right",
    label: "Align column right",
    command: "align-column",
    argument: "right",
  },
  {
    id: "align-default",
    label: "Default column alignment",
    command: "align-column",
    argument: "default",
  },
  { id: "format-table", label: "Format table", command: "format-table" },
];

export function tableMenuItems(
  availability: Readonly<Record<TableCommand, boolean>>,
): MenuItem<TableMenuId>[] {
  return ENTRIES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: tableMenuIcons[entry.id],
    disabled: !availability[entry.command],
    ...(entry.destructive === true ? { destructive: true } : {}),
  }));
}

export function tableMenuCommand(id: TableMenuId): {
  command: TableCommand;
  argument?: ColumnAlignment;
} {
  const entry = ENTRIES.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`Unknown table menu item: ${id}`);
  return entry.argument === undefined
    ? { command: entry.command }
    : { command: entry.command, argument: entry.argument };
}
