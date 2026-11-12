import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { KEY_DERIVATION_TIMEOUT } from "../helpers";

export function shareDialog(page: Page, name = "Welcome"): Locator {
  return page.getByRole("dialog", { name: `Share “${name}”` });
}

export async function createLink(
  page: Page,
  options: { password?: string; name?: string } = {},
): Promise<string> {
  const dialog = shareDialog(page);
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
