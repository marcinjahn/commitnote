import { describe, expect, it } from "vitest";
import {
  TABLE_COMMANDS,
  type TableCommand,
} from "../../markdown/table-commands";
import { tableMenuCommand, tableMenuItems } from "./table-menu";

function availability(
  enabled: readonly TableCommand[],
): Record<TableCommand, boolean> {
  return Object.fromEntries(
    TABLE_COMMANDS.map((command) => [command, enabled.includes(command)]),
  ) as Record<TableCommand, boolean>;
}

describe("tableMenuItems", () => {
  it("lists the commands in order with their labels", () => {
    expect(
      tableMenuItems(availability([])).map(({ id, label }) => [id, label]),
    ).toEqual([
      ["insert-table", "Insert table"],
      ["insert-row-above", "Insert row above"],
      ["insert-row-below", "Insert row below"],
      ["insert-column-left", "Insert column left"],
      ["insert-column-right", "Insert column right"],
      ["delete-row", "Delete row"],
      ["delete-column", "Delete column"],
      ["align-left", "Align column left"],
      ["align-center", "Align column center"],
      ["align-right", "Align column right"],
      ["align-default", "Default column alignment"],
      ["format-table", "Format table"],
    ]);
  });

  it("marks only the delete items destructive", () => {
    const destructive = tableMenuItems(availability([]))
      .filter((item) => item.destructive === true)
      .map((item) => item.id);
    expect(destructive).toEqual(["delete-row", "delete-column"]);
  });

  it("disables every item when nothing is available", () => {
    expect(
      tableMenuItems(availability([])).every((item) => item.disabled === true),
    ).toBe(true);
  });

  it("enables every item when everything is available", () => {
    expect(
      tableMenuItems(availability(TABLE_COMMANDS)).some(
        (item) => item.disabled === true,
      ),
    ).toBe(false);
  });

  it("follows the availability of each item's command", () => {
    const items = tableMenuItems(
      availability(["insert-table", "align-column"]),
    );
    const enabled = items
      .filter((item) => item.disabled !== true)
      .map((item) => item.id);
    expect(enabled).toEqual([
      "insert-table",
      "align-left",
      "align-center",
      "align-right",
      "align-default",
    ]);
  });

  it("draws an icon for every item", () => {
    for (const item of tableMenuItems(availability([]))) {
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("tableMenuCommand", () => {
  it("maps ids to commands", () => {
    expect(tableMenuCommand("insert-table")).toEqual({
      command: "insert-table",
    });
    expect(tableMenuCommand("insert-row-above")).toEqual({
      command: "insert-row-above",
    });
    expect(tableMenuCommand("insert-row-below")).toEqual({
      command: "insert-row-below",
    });
    expect(tableMenuCommand("insert-column-left")).toEqual({
      command: "insert-column-left",
    });
    expect(tableMenuCommand("insert-column-right")).toEqual({
      command: "insert-column-right",
    });
    expect(tableMenuCommand("delete-row")).toEqual({ command: "delete-row" });
    expect(tableMenuCommand("delete-column")).toEqual({
      command: "delete-column",
    });
    expect(tableMenuCommand("format-table")).toEqual({
      command: "format-table",
    });
  });

  it("maps the alignment ids to align-column with the alignment", () => {
    expect(tableMenuCommand("align-left")).toEqual({
      command: "align-column",
      argument: "left",
    });
    expect(tableMenuCommand("align-center")).toEqual({
      command: "align-column",
      argument: "center",
    });
    expect(tableMenuCommand("align-right")).toEqual({
      command: "align-column",
      argument: "right",
    });
    expect(tableMenuCommand("align-default")).toEqual({
      command: "align-column",
      argument: "default",
    });
  });
});
