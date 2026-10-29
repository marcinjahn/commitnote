import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { enableVimMode } from "./helpers/settings";
import { openWelcome } from "./helpers/tree";

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
