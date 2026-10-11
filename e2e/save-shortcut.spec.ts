import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { fakeForge, openNotes } from "./helpers";
import { openSettings } from "./helpers/settings";
import { openWelcome } from "./helpers/tree";

const OFFLINE_LONG =
  "Offline. Changes will save when you're back online. Keep this tab open.";

function infoToast(page: Page, text: string) {
  return page
    .locator('[role="group"][aria-label="Info"]:not([inert])')
    .filter({ hasText: text });
}

async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.type(text);
}

test.beforeEach(async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
});

test("saving with nothing pending shows an info toast", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+s");

  const toast = infoToast(page, "All saved");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "info");
});

test("repeated presses save an edit once and keep the editor focused", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();
  await typeInEditor(page, " saved with a shortcut");

  await page.keyboard.press("ControlOrMeta+s");
  await page.keyboard.press("ControlOrMeta+s");
  await page.keyboard.press("ControlOrMeta+s");

  await expect(infoToast(page, "All saved")).toBeVisible();
  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
  expect(await fakeForge(page).commitCount()).toBe(before + 1);
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeFocused();
});

test("an unsaved edit made offline shows the offline copy and saves when back online", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();

  await page.context().setOffline(true);
  try {
    await typeInEditor(page, " written offline");
    await page.keyboard.press("ControlOrMeta+s");

    await expect(infoToast(page, OFFLINE_LONG)).toBeVisible();
    expect(await fakeForge(page).commitCount()).toBe(before);
  } finally {
    await page.context().setOffline(false);
  }

  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
});

test("the shortcut works from the note name field", async ({ page }) => {
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.focus();

  await page.keyboard.press("ControlOrMeta+s");

  await expect(infoToast(page, "All saved")).toBeVisible();
  await expect(field).toBeFocused();
});

test("the shortcut works with the settings panel open", async ({ page }) => {
  const dialog = await openSettings(page);

  await page.keyboard.press("ControlOrMeta+s");

  await expect(infoToast(page, "All saved")).toBeVisible();
  await expect(dialog).toBeVisible();
});
