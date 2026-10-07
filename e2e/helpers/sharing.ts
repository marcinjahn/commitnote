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
