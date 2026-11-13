import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { KEY_DERIVATION_TIMEOUT } from "../helpers";
import { openRowMenu } from "./tree";

export function shareDialog(page: Page, name = "Welcome"): Locator {
  return page.getByRole("dialog", { name: `Share “${name}”` });
}

export async function createLink(
  page: Page,
  options: { password?: string; name?: string; note?: string } = {},
): Promise<string> {
  const dialog = shareDialog(page, options.note);
  await expect(dialog).toBeVisible();
  if (options.name !== undefined) {
    await dialog
      .getByRole("textbox", { name: "Name (optional)" })
      .fill(options.name);
  }
  if (options.password !== undefined) {
    await dialog
      .getByRole("textbox", { name: "Password (optional)" })
      .fill(options.password);
  }
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
  return link.inputValue();
}

export async function shareNote(
  page: Page,
  options: { note?: string; password?: string } = {},
): Promise<string> {
  const note = options.note ?? "Welcome";
  const menu = await openRowMenu(page, note);
  await menu.getByRole("menuitem", { name: "Share…" }).click();
  const link = await createLink(page, options);
  await page.keyboard.press("Escape");
  await expect(shareDialog(page, note)).toHaveCount(0);
  return link;
}

export async function openRecipientViewer(
  page: Page,
  link: string,
): Promise<Page> {
  const viewer = await page.context().newPage();
  await viewer.addInitScript(() =>
    localStorage.removeItem("commitnote.repoUrl"),
  );
  await viewer.goto(link);
  return viewer;
}

export function shareInvite(page: Page): Locator {
  return page.getByRole("complementary", { name: "About commitnote" });
}

export async function openSharedLinks(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Shared links" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Shared links" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function shareAction(
  list: Locator,
  title: string,
  item: string,
): Promise<void> {
  await list.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await list
    .getByRole("button", { name: `Share actions for ${title}` })
    .click();
  await list
    .page()
    .getByRole("menu", { name: `Share actions for ${title}` })
    .getByRole("menuitem", { name: item })
    .click();
}
