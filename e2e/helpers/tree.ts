import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { flushPendingSaves } from "../helpers";

export function treeItem(page: Page, name: string | RegExp): Locator {
  return page.getByRole("treeitem", { name, exact: true });
}

export function treeRows(page: Page): Locator {
  return page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
}

export async function openWelcome(page: Page): Promise<void> {
  await treeItem(page, "Welcome").click();
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Welcome",
  );
}

export function movedToast(page: Page): Locator {
  return page.getByRole("group").filter({ hasText: "moved to" });
}

export async function moveToTrash(
  page: Page,
  name: string,
  dialogText?: RegExp,
): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Move to trash?" }),
  ).toBeVisible();
  if (dialogText !== undefined) {
    await expect(dialog.getByText(dialogText)).toBeVisible();
  }
  await dialog
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

export async function openTrash(page: Page): Promise<Locator> {
  await page.getByTestId("open-trash").click();
  const dialog = page.getByRole("dialog", { name: "Trash" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export function trashRow(page: Page, name: string): Locator {
  return page.getByTestId("trash-row").filter({
    has: page.getByRole("button", { name: `Restore ${name} to…`, exact: true }),
  });
}

export async function restoreTo(
  page: Page,
  name: string,
  folder: string,
): Promise<void> {
  await page.getByRole("button", { name: `Restore ${name} to…`, exact: true }).click();
  const picker = page.getByRole("dialog", { name: /^Restore .* to folder$/ });
  await expect(picker).toBeVisible();
  await picker.getByRole("radio", { name: folder, exact: true }).check();
  await picker.getByRole("button", { name: "Restore", exact: true }).click();
}

export async function openHistory(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Version history" }).click();
  const dialog = page.getByRole("dialog", { name: "Version history" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("history-end")).toHaveText("Note created.");
  return dialog;
}

export function headerSyncIcon(page: Page): Locator {
  return page.locator("header.note-header").getByRole("img");
}

export async function waitForSynced(page: Page): Promise<void> {
  await flushPendingSaves(page);
  await expect(headerSyncIcon(page)).toHaveCount(0, { timeout: 15_000 });
}
