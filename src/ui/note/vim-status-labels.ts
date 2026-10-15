import type { CommandLineKind, VimEditingMode } from "../../editor/vim/vim-status";

const MODE_LABELS: Record<VimEditingMode, string> = {
  normal: "NORMAL",
  insert: "INSERT",
  visual: "VISUAL",
  "visual-line": "V-LINE",
  "visual-block": "V-BLOCK",
  replace: "REPLACE",
};

const MODE_ANNOUNCEMENTS: Record<VimEditingMode, string> = {
  normal: "Normal mode",
  insert: "Insert mode",
  visual: "Visual mode",
  "visual-line": "Visual line mode",
  "visual-block": "Visual block mode",
  replace: "Replace mode",
};

const MODE_BUTTON_NAMES: Record<VimEditingMode, string> = {
  normal: "Mode: Normal. Switch to Insert mode",
  insert: "Mode: Insert. Switch to Normal mode",
  visual: "Mode: Visual. Switch to Normal mode",
  "visual-line": "Mode: Visual line. Switch to Normal mode",
  "visual-block": "Mode: Visual block. Switch to Normal mode",
  replace: "Mode: Replace. Switch to Normal mode",
};

const COMMAND_LINE_LABELS: Record<CommandLineKind, string> = {
  ":": "Vim command",
  "/": "Search forward",
  "?": "Search backward",
};

export function editingModeLabel(mode: VimEditingMode): string {
  return MODE_LABELS[mode];
}

export function editingModeAnnouncement(mode: VimEditingMode): string {
  return MODE_ANNOUNCEMENTS[mode];
}

export function modeButtonName(mode: VimEditingMode): string {
  return MODE_BUTTON_NAMES[mode];
}

export function isAccentedMode(mode: VimEditingMode): boolean {
  return mode !== "normal";
}

export function formatPosition(line: number, column: number): string {
  return `${line}:${column}`;
}

export function positionLabel(line: number, column: number): string {
  return `Line ${line}, column ${column}`;
}

export function commandLineLabel(kind: CommandLineKind): string {
  return COMMAND_LINE_LABELS[kind];
}
