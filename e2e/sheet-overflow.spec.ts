import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree } from "./helpers";
import { emulateStandalone } from "./helpers/install";
import { createLink, shareDialog } from "./helpers/sharing";
import { openDataSecurityAction, openSettings } from "./helpers/settings";
import {
  moveToTrash,
  openHistory,
  openRowMenu,
  openTrash,
  openWelcome,
} from "./helpers/tree";

const HEIGHT = 740;
const LONG_DEVICE_NAME = "device-".repeat(10) + "abc";

async function overflowOf(page: Page, dialog: Locator): Promise<number[]> {
  const body = await dialog
    .locator(".dialog-body")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  const document = await page.evaluate(
    () =>
      window.document.documentElement.scrollWidth -
      window.document.documentElement.clientWidth,
  );
  return [body, document];
}

async function expectSheetFits(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => Math.max(...(await overflowOf(page, dialog))))
    .toBeLessThanOrEqual(0);
}

async function closeSheet(dialog: Locator): Promise<void> {
  await dialog.page().keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test.describe("sheets at phone widths", { tag: "@mobile" }, () => {
  test("Settings fits at every phone width with a long device name", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: HEIGHT });
    await openNotes(page);
    const dialog = await openSettings(page);
    await dialog
      .getByRole("textbox", { name: "Device name" })
      .fill(LONG_DEVICE_NAME);

    for (const width of [320, 360, 375, 390, 412, 430]) {
      await page.setViewportSize({ width, height: HEIGHT });
      await expectSheetFits(page, dialog);
    }
  });

  test("Settings fits at 320 px in an installed app", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: HEIGHT });
    await emulateStandalone(page);
    await openNotes(page);
    await expectSheetFits(page, await openSettings(page));
  });

  test("note sheets fit at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: HEIGHT });
    await openNotes(page);

    await page.getByRole("button", { name: "New folder" }).click();
    const newFolder = page.getByRole("dialog");
    await expectSheetFits(page, newFolder);
    await newFolder.getByLabel("Folder name").fill("Recipes");
    await newFolder.getByRole("button", { name: "Create", exact: true }).click();
    await expect(newFolder).toHaveCount(0);

    await openRowMenu(page, "Welcome");
    await page.getByRole("menuitem", { name: "Move to folder…" }).click();
    const move = page.getByRole("dialog");
    await expectSheetFits(page, move);
    await closeSheet(move);

    await openRowMenu(page, "Welcome");
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const share = shareDialog(page);
    await expectSheetFits(page, share);
    await createLink(page);
    await expectSheetFits(page, share);
    await closeSheet(share);

    await page.getByRole("button", { name: "More commands" }).click();
    await page
      .getByRole("menu", { name: "Commands" })
      .getByRole("menuitem", { name: "Shared links" })
      .click();
    const links = page.getByRole("dialog", { name: "Shared links" });
    await expectSheetFits(page, links);
    await closeSheet(links);

    await openRowMenu(page, "Welcome");
    await page.getByRole("menuitem", { name: "Move to trash…" }).click();
    const confirm = page.getByRole("dialog");
    await expectSheetFits(page, confirm);
    await closeSheet(confirm);

    await openWelcome(page);
    await expectSheetFits(page, await openHistory(page));
  });

  test("trash and passphrase sheets fit at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: HEIGHT });
    await openNotes(page);
    await moveToTrash(page, "Welcome");
    await showTree(page);

    const trash = await openTrash(page);
    await expectSheetFits(page, trash);
    await page
      .getByRole("button", { name: "Restore Welcome to…", exact: true })
      .click();
    const picker = page.getByRole("dialog", { name: /^Restore .* to folder$/ });
    await expectSheetFits(page, picker);
    await picker.getByRole("button", { name: "Cancel" }).click();
    await expect(picker).toHaveCount(0);
    await closeSheet(trash);

    await openDataSecurityAction(page, "Change passphrase");
    await expectSheetFits(
      page,
      page.getByRole("dialog", { name: "Change passphrase" }),
    );
  });

  test("More commands scrolls on a short viewport and End reaches the last item", async ({
    page,
  }) => {
    await openNotes(page);
    await showTree(page);
    await page.setViewportSize({ width: 412, height: 140 });
    await page.getByRole("button", { name: "More commands" }).click();

    const menu = page.getByRole("menu", { name: "Commands" });
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await menu.boundingBox())!;
        return box.y >= 0 && box.y + box.height <= 140;
      })
      .toBe(true);
    await expect
      .poll(() => menu.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);

    await menu.getByRole("menuitem").first().focus();
    await page.keyboard.press("End");

    await expect(menu.getByRole("menuitem").last()).toBeFocused();
    await expect(menu.getByRole("menuitem").last()).toBeInViewport();
  });
});
