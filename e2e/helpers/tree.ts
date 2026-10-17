import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { flushPendingSaves } from "../helpers";

export function treeItem(page: Page, name: string | RegExp): Locator {
  return page.getByRole("treeitem", { name, exact: true });
}

export async function openRowMenu(page: Page, name: string): Promise<Locator> {
  await treeItem(page, name).focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: `Actions for ${name}` });
  await expect(menu).toBeVisible();
  return menu;
}

export function rowActionsButton(page: Page, name: string): Locator {
  return page
    .locator("[data-tree-row]")
    .filter({ has: treeItem(page, name) })
    .locator('button[aria-haspopup="menu"]');
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
  await openRowMenu(page, name);
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
  const trashButton = page.getByTestId("open-trash");
  await trashButton.focus();
  await page.keyboard.press("Enter");
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

export interface DropPoint {
  /** Fraction of the target row's height. */
  readonly y: number;
  /** Pointer x from the row's left edge; defaults to the middle. */
  readonly x?: number;
}

// Presses the row, moves past the drag threshold and on to the drop point
// on `target`, holding the drag there.
export async function hoverDrag(
  page: Page,
  source: Locator,
  target: Locator,
  point: DropPoint,
): Promise<void> {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const startX = from.x + 40;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 2 });
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await page.mouse.move(
    to.x + (point.x ?? to.width / 2),
    to.y + to.height * point.y,
    { steps: 10 },
  );
}

export async function release(page: Page): Promise<void> {
  await page.mouse.up();
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
}

export async function liftRow(page: Page, source: Locator): Promise<void> {
  const from = (await source.boundingBox())!;
  const startX = from.x + 40;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 2 });
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
}

export async function hoverOnto(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10,
  });
}
