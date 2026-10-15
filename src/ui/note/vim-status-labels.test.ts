import { describe, expect, it } from "vitest";
import type { VimEditingMode } from "../../editor/vim/vim-status";
import {
  commandLineLabel,
  editingModeAnnouncement,
  editingModeLabel,
  formatPosition,
  isAccentedMode,
  modeButtonName,
  positionLabel,
} from "./vim-status-labels";

const rows: [VimEditingMode, string, string, string][] = [
  ["normal", "NORMAL", "Normal mode", "Mode: Normal. Switch to Insert mode"],
  ["insert", "INSERT", "Insert mode", "Mode: Insert. Switch to Normal mode"],
  ["visual", "VISUAL", "Visual mode", "Mode: Visual. Switch to Normal mode"],
  ["visual-line", "V-LINE", "Visual line mode", "Mode: Visual line. Switch to Normal mode"],
  ["visual-block", "V-BLOCK", "Visual block mode", "Mode: Visual block. Switch to Normal mode"],
  ["replace", "REPLACE", "Replace mode", "Mode: Replace. Switch to Normal mode"],
];

describe("mode labels", () => {
  it.each(rows)("maps %s", (mode, label, announcement, buttonName) => {
    expect(editingModeLabel(mode)).toBe(label);
    expect(editingModeAnnouncement(mode)).toBe(announcement);
    expect(modeButtonName(mode)).toBe(buttonName);
  });

  it.each(rows)("accents %s unless it is normal", (mode) => {
    expect(isAccentedMode(mode)).toBe(mode !== "normal");
  });
});

describe("position", () => {
  it("formats line and column", () => {
    expect(formatPosition(12, 5)).toBe("12:5");
  });

  it("describes line and column for screen readers", () => {
    expect(positionLabel(12, 5)).toBe("Line 12, column 5");
  });
});

describe("commandLineLabel", () => {
  it.each([
    [":", "Vim command"],
    ["/", "Search forward"],
    ["?", "Search backward"],
  ] as const)("labels %s", (kind, label) => {
    expect(commandLineLabel(kind)).toBe(label);
  });
});
