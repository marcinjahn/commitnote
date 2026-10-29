import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree } from "./helpers";
import { enableVimMode } from "./helpers/settings";
import { moveToTrash, openWelcome } from "./helpers/tree";

const FORMATTED_DELIMITER = "| -------- | -------- |";
const DELIMITER = "| --- | --- |";

const pane = (page: Page) => page.locator("#note-pane");
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });
const tables = (page: Page) => pane(page).locator("table.cm-table");
const line = (page: Page, text: string) =>
  pane(page).locator(".cm-line", { hasText: text });
const selectedText = (page: Page) =>
  page.evaluate(() => getSelection()?.toString() ?? "");
const modeText = (page: Page) => page.locator(".vim-status-bar .mode-label");

async function openWelcomeNote(page: Page): Promise<void> {
  await openNotes(page);
  await openWelcome(page);
  await expect(tables(page)).toHaveCount(1);
}

async function revealFirstHeader(page: Page): Promise<void> {
  await tables(page).getByRole("columnheader", { name: "Column A" }).click();
  await expect(tables(page)).toHaveCount(0);
  await expect(line(page, DELIMITER)).toBeVisible();
}

async function expectSelected(page: Page, text: string): Promise<void> {
  await expect.poll(() => selectedText(page)).toBe(text);
}

function emptyRows(page: Page): Locator {
  return pane(page).locator(".cm-line", { hasText: /^\|\s+\|\s+\|$/ });
}

test("Tab formats the table and walks through the cells", async ({ page }) => {
  await openWelcomeNote(page);
  await revealFirstHeader(page);

  await page.keyboard.press("Tab");
  await expect(line(page, FORMATTED_DELIMITER)).toBeVisible();
  await expectSelected(page, "Column B");

  await page.keyboard.type("Z");
  await expect(line(page, "Column A")).toHaveText("| Column A | Z |");

  await page.keyboard.press("Tab");
  await expect(line(page, "| 1")).toHaveText("| 1        | 2        |");
  await expectSelected(page, "1");

  await page.keyboard.press("Tab");
  await expectSelected(page, "2");
  await expect(editor(page)).toBeFocused();
});

test("Tab in the last cell adds a row", async ({ page }) => {
  await openWelcomeNote(page);
  await revealFirstHeader(page);
  await expect(emptyRows(page)).toHaveCount(0);

  for (const cell of ["Column B", "1", "2"]) {
    await page.keyboard.press("Tab");
    await expectSelected(page, cell);
  }
  await page.keyboard.press("Tab");

  await expect(emptyRows(page)).toHaveCount(1);
  await expect(editor(page)).toBeFocused();
});

test("Shift-Tab in the first header cell keeps the caret and focus", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await revealFirstHeader(page);

  await page.keyboard.press("Shift+Tab");

  await expect(editor(page)).toBeFocused();
  await expectSelected(page, "");
  await page.keyboard.type("Z");
  await expect(line(page, "Column A")).toHaveText("| Column AZ | Column B |");
});

test("one undo restores the table a Tab formatted", async ({ page }) => {
  await openWelcomeNote(page);
  await revealFirstHeader(page);

  await page.keyboard.press("Tab");
  await expect(line(page, FORMATTED_DELIMITER)).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Z");

  await expect(line(page, DELIMITER)).toBeVisible();
  await expect(line(page, FORMATTED_DELIMITER)).toHaveCount(0);
  await expect(line(page, "Column A")).toHaveText("| Column A | Column B |");
});

test("Tab outside a table still indents", async ({ page }) => {
  await openWelcomeNote(page);

  await line(page, "Notes stay private").click();
  await page.keyboard.press("Tab");

  await expect
    .poll(() =>
      line(page, "Notes stay private").evaluate((el) => el.textContent),
    )
    .toMatch(/^ {2}> Notes stay private/);
  await expect(tables(page)).toHaveCount(1);
});

test("Vim :table inserts a table with its first header selected", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await openWelcome(page);
  await editor(page).focus();
  await expect(modeText(page)).toHaveText("NORMAL");

  await page.keyboard.press("G");
  await page.keyboard.type(":table");
  await page.keyboard.press("Enter");

  await expect(line(page, "Column 1")).toHaveText(
    "| Column 1 | Column 2 | Column 3 |",
  );
  await expect(modeText(page)).toHaveText("VISUAL");
  await expectSelected(page, "Column 1");

  await page.keyboard.type("c");
  await expect(modeText(page)).toHaveText("INSERT");
  await page.keyboard.type("Name");
  await expect(line(page, "Name")).toHaveText("| Name | Column 2 | Column 3 |");
});

const tableButton = (page: Page) =>
  page.getByRole("button", { name: "Table", exact: true });
const tableMenu = (page: Page) => page.getByRole("menu", { name: "Table" });
const menuItem = (page: Page, name: string) =>
  tableMenu(page).getByRole("menuitem", { name, exact: true });

const MENU_ITEMS = [
  "Insert table",
  "Insert row above",
  "Insert row below",
  "Insert column left",
  "Insert column right",
  "Delete row",
  "Delete column",
  "Align column left",
  "Align column center",
  "Align column right",
  "Default column alignment",
  "Format table",
];

async function openTableMenu(page: Page): Promise<void> {
  await tableButton(page).click();
  await expect(tableMenu(page)).toBeVisible();
}

async function runTableMenuItem(page: Page, name: string): Promise<void> {
  await openTableMenu(page);
  await menuItem(page, name).click();
  await expect(tableMenu(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
}

function tableSource(page: Page): Promise<string[]> {
  return pane(page)
    .locator(".cm-line")
    .evaluateAll((lines) =>
      lines
        .map((el) => el.textContent ?? "")
        .filter((text) => text.startsWith("|")),
    );
}

async function placeCaretInBodyCell(page: Page): Promise<void> {
  await tables(page).getByRole("cell", { name: "1", exact: true }).click();
  await expect(tables(page)).toHaveCount(0);
  await expect(line(page, "| 1")).toBeVisible();
  await expect(editor(page)).toBeFocused();
}

test("the Table menu offers only Insert table outside a table", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await line(page, "Notes stay private").click();

  await openTableMenu(page);

  await expect(tableMenu(page).getByRole("menuitem")).toHaveText(MENU_ITEMS);
  await expect(menuItem(page, "Insert table")).toBeEnabled();
  for (const name of MENU_ITEMS.slice(1)) {
    await expect(menuItem(page, name)).toBeDisabled();
  }
});

test("Insert table from the Table menu selects the first header and keeps focus", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await line(page, "Notes stay private").click();

  await runTableMenuItem(page, "Insert table");

  await expect(line(page, "Column 1")).toHaveText(
    "| Column 1 | Column 2 | Column 3 |",
  );
  await expectSelected(page, "Column 1");
  await page.keyboard.type("Name");
  await expect(line(page, "Name")).toHaveText("| Name | Column 2 | Column 3 |");
});

test("each table menu command is one undo step", async ({ page }) => {
  await openWelcomeNote(page);
  await placeCaretInBodyCell(page);
  const original = await tableSource(page);
  expect(original).toEqual([
    "| Column A | Column B |",
    "| --- | --- |",
    "| 1 | 2 |",
  ]);

  const commands: [string, (source: string[]) => void][] = [
    ["Insert row below", (source) => expect(source).toHaveLength(4)],
    [
      "Insert column right",
      (source) =>
        expect(source[0]).toMatch(/^\| Column A \|\s+\| Column B \|$/),
    ],
    [
      "Align column center",
      (source) => expect(source[1]).toMatch(/^\| :-+: \| -+ \|$/),
    ],
    ["Delete column", (source) => expect(source[0]).toBe("| Column B |")],
    ["Delete row", (source) => expect(source).toHaveLength(2)],
  ];

  for (const [name, expectChanged] of commands) {
    await runTableMenuItem(page, name);
    await expect.poll(() => tableSource(page)).not.toEqual(original);
    expectChanged(await tableSource(page));

    await page.keyboard.press("ControlOrMeta+Z");
    await expect.poll(() => tableSource(page)).toEqual(original);
  }
});

test("the header row cannot be deleted or have a row inserted above", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await revealFirstHeader(page);

  await openTableMenu(page);

  await expect(menuItem(page, "Delete row")).toBeDisabled();
  await expect(menuItem(page, "Insert row above")).toBeDisabled();
  await expect(menuItem(page, "Insert row below")).toBeEnabled();
});

test("the Table menu works from the keyboard and announces unavailable items", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await line(page, "Notes stay private").click();

  await tableButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(tableMenu(page)).toBeVisible();
  await expect(menuItem(page, "Insert table")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(menuItem(page, "Insert row above")).toBeFocused();
  await expect(menuItem(page, "Insert row above")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  const before = await line(page, "Notes stay private").textContent();
  await page.keyboard.press("Enter");
  await expect(tableMenu(page)).toBeVisible();
  await expect(menuItem(page, "Insert row above")).toBeFocused();
  expect(await line(page, "Notes stay private").textContent()).toBe(before);

  await page.keyboard.press("Escape");
  await expect(tableMenu(page)).toHaveCount(0);
  await expect(tableButton(page)).toBeFocused();
});

test("More commands offers Insert table right after Insert image", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await line(page, "Notes stay private").click();

  await page.getByRole("button", { name: "More commands" }).click();
  const commands = page.getByRole("menu", { name: "Commands" });
  const items = commands.getByRole("menuitem");
  await expect(items.nth(0)).toHaveText("Insert image");
  await expect(items.nth(1)).toHaveText("Insert table");
  await items.nth(1).click();

  await expect(line(page, "Column 1")).toHaveText(
    "| Column 1 | Column 2 | Column 3 |",
  );
  await expectSelected(page, "Column 1");
  await expect(editor(page)).toBeFocused();
});

test("a trashed note shows no Table button", async ({ page }) => {
  await openWelcomeNote(page);
  await expect(tableButton(page)).toBeVisible();

  await moveToTrash(page, "Welcome");

  await expect(page.getByText("This note was moved to trash.")).toBeVisible();
  await expect(tableButton(page)).toHaveCount(0);
});

test.describe("on a phone", () => {
  test("the Table menu fits the viewport and its items are touch sized @mobile", async ({
    page,
  }) => {
    await openNotes(page);
    await showTree(page);
    await openWelcome(page);
    await expect(tables(page)).toHaveCount(1);
    await expect(tableButton(page)).toBeVisible();
    await openTableMenu(page);

    const viewport = page.viewportSize()!;
    const items = tableMenu(page).getByRole("menuitem");
    await expect(items).toHaveCount(MENU_ITEMS.length);
    for (const item of await items.all()) {
      const box = (await item.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const menuBox = (await tableMenu(page).boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
  });

  test("on a short viewport the Table menu scrolls and End reaches the last item @mobile", async ({
    page,
  }) => {
    await openNotes(page);
    await showTree(page);
    await openWelcome(page);
    await page.setViewportSize({ width: 412, height: 400 });
    await openTableMenu(page);

    await expect
      .poll(async () => {
        const box = (await tableMenu(page).boundingBox())!;
        return box.y >= 0 && box.y + box.height <= 400;
      })
      .toBe(true);
    await expect
      .poll(() =>
        tableMenu(page).evaluate((el) => el.scrollHeight > el.clientHeight),
      )
      .toBe(true);

    await menuItem(page, "Insert table").focus();
    await page.keyboard.press("End");

    await expect(menuItem(page, "Format table")).toBeFocused();
    await expect(menuItem(page, "Format table")).toBeInViewport();
  });
});
