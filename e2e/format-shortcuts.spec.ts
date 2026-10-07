import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { flushPendingSaves, openNotes } from "./helpers";
import { openWelcome } from "./helpers/tree";

async function typeWordLine(page: Page): Promise<Locator> {
  await openNotes(page);
  await openWelcome(page);
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("alpha zzword");
  await expect(content).toContainText("alpha zzword");
  return content;
}

async function selectLastWord(page: Page): Promise<void> {
  for (let i = 0; i < "zzword".length; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
}

function line(page: Page): Locator {
  return page.locator(".cm-line", { hasText: "alpha" });
}

test("bold wraps the selected word and toggles back", async ({ page }) => {
  await typeWordLine(page);
  await selectLastWord(page);

  await page.keyboard.press("ControlOrMeta+b");
  await expect(line(page)).toHaveText("alpha **zzword**");

  await page.keyboard.press("ControlOrMeta+b");
  await expect(line(page)).toHaveText("alpha zzword");
});

test("italic wraps the selected word", async ({ page }) => {
  await typeWordLine(page);
  await selectLastWord(page);

  await page.keyboard.press("ControlOrMeta+i");
  await expect(line(page)).toHaveText("alpha *zzword*");
});

test("strikethrough wraps the selected word", async ({ page }) => {
  await typeWordLine(page);
  await selectLastWord(page);

  await page.keyboard.press("ControlOrMeta+Shift+x");
  await expect(line(page)).toHaveText("alpha ~~zzword~~");
});

test("link wraps the selected word and leaves the caret in the parentheses", async ({
  page,
}) => {
  await typeWordLine(page);
  await selectLastWord(page);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(line(page)).toHaveText("alpha [zzword]()");
  await page.keyboard.type("https://x.y");
  await expect(line(page)).toHaveText("alpha [zzword](https://x.y)");
});

test("one undo reverts one formatting step", async ({ page }) => {
  await typeWordLine(page);
  await selectLastWord(page);

  await page.keyboard.press("ControlOrMeta+b");
  await expect(line(page)).toHaveText("alpha **zzword**");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(line(page)).toHaveText("alpha zzword");
});

test("task toggle shortcut adds, checks and undoes one step", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("buy milk");
  const checkbox = content.locator(".cm-line", { hasText: "buy milk" }).locator(
    "input[type=checkbox]",
  );

  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(checkbox).toBeChecked();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(checkbox).not.toBeChecked();

  await flushPendingSaves(page);
});
