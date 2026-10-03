import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expectTree, logIn } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const REPO_KEY = "sample/notes";
const PASSPHRASE = "sample notes repo passphrase";

function commitMessages(page: Page): Promise<string[]> {
  return page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.commitMessages(repoKey) as string[],
    REPO_KEY,
  );
}

function settingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "Settings" });
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  await expect(settingsDialog(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
  await expectTree(page);
});

test("Settings is the first command and opens a dialog with no settings yet", async ({
  page,
}) => {
  const commitsBefore = await commitMessages(page);

  await page.getByRole("button", { name: "More commands" }).click();
  const items = page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem");
  await expect(items.first()).toHaveText("Settings");
  await items.first().click();

  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("No settings yet.")).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("body")).toBeFocused();

  await openSettings(page);
  await settingsDialog(page).getByRole("button", { name: "Close" }).click();
  await expect(settingsDialog(page)).toHaveCount(0);

  expect(await commitMessages(page)).toEqual(commitsBefore);
});

test("clicking the backdrop closes the Settings dialog", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the dialog is a bottom sheet with no clickable backdrop corner");
  await openSettings(page);
  await page.mouse.click(1, 1);
  await expect(settingsDialog(page)).toHaveCount(0);
});
