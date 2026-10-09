import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openNotes } from "./helpers";
import {
  openDataSecurityAction,
  openSettings,
  settingsDialog,
} from "./helpers/settings";
import { openHistory, openWelcome } from "./helpers/tree";

function nameField(page: Page): Locator {
  return page.getByRole("textbox", { name: "Note name" });
}

function notesTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Notes" });
}

function openDialogs(page: Page): Locator {
  return page.locator("dialog[open]");
}

async function openSearchPalette(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Search notes" }).click();
  const palette = page.getByRole("dialog", { name: "Search notes" });
  await expect(palette).toBeVisible();
  return palette;
}

function hashOf(page: Page): string {
  return new URL(page.url()).hash;
}

function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => history.length);
}

test.describe("Back closes dialogs", { tag: "@mobile" }, () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("closes an open dialog and stays on the same view", async ({ page }) => {
    const url = page.url();
    const length = await historyLength(page);

    await openSettings(page);
    await expect.poll(() => historyLength(page)).toBe(length + 1);
    await page.goBack();

    await expect(openDialogs(page)).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(notesTree(page)).toBeVisible();
    await expect(nameField(page)).toHaveCount(0);
  });

  test("closes a dialog over the note view and keeps the note open", async ({
    page,
    isMobile,
  }) => {
    await openWelcome(page);
    await expect.poll(() => hashOf(page)).not.toBe("");
    const fragment = hashOf(page);
    const length = await historyLength(page);

    const dialog = isMobile
      ? await openHistory(page)
      : await openSearchPalette(page);
    await expect.poll(() => historyLength(page)).toBe(length + 1);
    await page.goBack();

    await expect(dialog).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("Welcome");
    expect(hashOf(page)).toBe(fragment);

    await page.goBack();

    await expect.poll(() => hashOf(page)).toBe("");
    await expect(nameField(page)).toHaveCount(0);
    await expect(notesTree(page)).toBeVisible();
  });

  test("closes the search palette opened from the tree", async ({ page }) => {
    const url = page.url();
    const length = await historyLength(page);

    const palette = await openSearchPalette(page);
    await expect.poll(() => historyLength(page)).toBe(length + 1);
    await page.goBack();

    await expect(palette).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(notesTree(page)).toBeVisible();
    await expect(nameField(page)).toHaveCount(0);
  });

  test("closes nested dialogs one at a time", async ({ page }) => {
    const url = page.url();
    const length = await historyLength(page);

    await openDataSecurityAction(page, "Change passphrase");
    const inner = page.getByRole("dialog", { name: "Change passphrase" });
    await expect(inner).toBeVisible();
    await expect(openDialogs(page)).toHaveCount(2);
    await expect.poll(() => historyLength(page)).toBe(length + 2);

    await page.goBack();
    await expect(inner).toHaveCount(0);
    await expect(settingsDialog(page)).toBeVisible();
    await expect(openDialogs(page)).toHaveCount(1);

    await page.goBack();
    await expect(openDialogs(page)).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(notesTree(page)).toBeVisible();
  });

  test("leaves no entry behind for a dialog closed from the UI", async ({
    page,
  }) => {
    const length = await historyLength(page);

    await openSettings(page);
    await expect.poll(() => historyLength(page)).toBe(length + 1);
    await page.keyboard.press("Escape");
    await expect(openDialogs(page)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => (history.state as { dialog?: boolean }).dialog),
      )
      .toBeUndefined();

    await openWelcome(page);
    await expect.poll(() => hashOf(page)).not.toBe("");
    expect(await historyLength(page)).toBe(length + 1);

    await page.goBack();
    await expect.poll(() => hashOf(page)).toBe("");
    await expect(nameField(page)).toHaveCount(0);
    await expect(notesTree(page)).toBeVisible();
  });

  test("opening the command menu pushes no entry", async ({ page }) => {
    const length = await historyLength(page);

    await page.getByRole("button", { name: "More commands" }).click();
    await expect(page.getByRole("menu", { name: "Commands" })).toBeVisible();

    expect(await historyLength(page)).toBe(length);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Commands" })).toHaveCount(0);
    expect(await historyLength(page)).toBe(length);
  });
});
