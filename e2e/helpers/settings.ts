import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { expectSettingsIdle, flushPendingSaves } from "../helpers";

export function settingsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Settings" });
}

export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openDataSecurityAction(
  page: Page,
  label: "Export notes" | "Import notes" | "Change passphrase",
): Promise<void> {
  const dialog = settingsDialog(page);
  if ((await dialog.count()) === 0) await openSettings(page);
  await dialog.getByRole("button", { name: label, exact: true }).click();
}

export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);
}

export async function enableVimMode(page: Page): Promise<void> {
  const dialog = await openSettings(page);
  await dialog.getByRole("checkbox", { name: "Vim mode" }).check();
  await flushPendingSaves(page);
  await expectSettingsIdle(page);
  await closeSettings(page);
}

export async function chooseOption(
  page: Page,
  section: string,
  name: string,
): Promise<void> {
  await settingsDialog(page)
    .getByRole("radiogroup", { name: section })
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) })
    .click();
}

export function chooseAccent(page: Page, name: string): Promise<void> {
  return chooseOption(page, "Accent color", name);
}

export function rootAccent(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim(),
  );
}

export function collectFontFiles(page: Page): string[] {
  const files: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith(".woff2")) files.push(path.split("/").pop()!);
  });
  return files;
}
