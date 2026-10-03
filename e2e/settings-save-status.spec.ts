import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expectTree, logIn } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const REPO_KEY = "sample/notes";
const PASSPHRASE = "sample notes repo passphrase";

function settingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "Settings" });
}

function dialogStatus(page: Page, text: string) {
  return settingsDialog(page).getByText(text, { exact: true });
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  await expect(settingsDialog(page)).toBeVisible();
}

async function chooseAccent(page: Page, name: string): Promise<void> {
  await settingsDialog(page)
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
  await expectTree(page);
});

test("choosing the option that is already selected shows no save status", async ({
  page,
}) => {
  await openSettings(page);

  await chooseAccent(page, "System");

  await page.waitForTimeout(1_500);
  await expect(settingsDialog(page).getByRole("status")).toHaveText("");
});

test("the Settings dialog shows a change waiting, saving, then saved", async ({
  page,
}) => {
  await openSettings(page);

  await chooseAccent(page, "Teal");

  await expect(dialogStatus(page, "Waiting to save")).toBeVisible();
  await expect(dialogStatus(page, "Saving")).toBeVisible({ timeout: 3_000 });
  await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
  await expect(settingsDialog(page).getByRole("status")).toContainText(
    "Settings saved",
  );
});

test("after closing Settings mid-save, the sidebar shows the save until it lands and reopens Settings", async ({
  page,
}) => {
  const indicator = page.getByRole("button", { name: "Saving settings" });
  await expect(indicator).toHaveCount(0);

  await openSettings(page);
  await chooseAccent(page, "Teal");
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);

  await expect(indicator).toBeVisible();
  await indicator.click();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("button", { name: /^(Saving settings|Settings waiting)/ }),
  ).toHaveCount(0);
});

async function failNextCommit(page: Page): Promise<void> {
  await page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.failNext(repoKey, "commit", "Server"),
    REPO_KEY,
  );
}

test("Retry after a failed settings save saves it at once", async ({ page }) => {
  await failNextCommit(page);
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await expect(dialogStatus(page, "Saving failed")).toBeVisible({
    timeout: 10_000,
  });

  await settingsDialog(page).getByRole("button", { name: "Retry" }).click();

  // Automatic retry only comes after a 5 s back-off.
  await expect(dialogStatus(page, "Saving")).toBeVisible({ timeout: 1_000 });
  await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
  await expect(
    settingsDialog(page).getByRole("button", { name: "Retry" }),
  ).toHaveCount(0);
});

test("a failed settings save stays visible in the sidebar after closing Settings", async ({
  page,
}) => {
  await failNextCommit(page);
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("button", { name: /^Saving settings failed, will retry/ }),
  ).toBeVisible({ timeout: 10_000 });
});
