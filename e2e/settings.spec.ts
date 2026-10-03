import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { chooseRepository, expectTree, logIn } from "./helpers";

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

const TEAL = "rgb(0, 133, 115)";
const PALETTE = ["System", "Blue", "Violet", "Pink", "Red", "Orange", "Green", "Teal"];

function rootAccent(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim(),
  );
}

function expectRootAccent(page: Page, color: string) {
  return expect.poll(() => rootAccent(page)).toBe(color);
}

async function chooseAccent(page: Page, name: string): Promise<void> {
  await settingsDialog(page)
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) })
    .click();
}

async function expectSettingsCommits(page: Page, count: number) {
  await expect
    .poll(async () => (await commitMessages(page)).length, { timeout: 10_000 })
    .toBe(count);
}

async function clickLogOut(page: Page): Promise<void> {
  const back = page.getByRole("button", { name: "Back to notes" });
  if (await back.isVisible()) {
    await back.click();
  }
  await page.getByRole("button", { name: "Log out", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
  await expectTree(page);
});

test("Settings is the first command and opens a dialog with the accent color options", async ({
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
  const group = dialog.getByRole("radiogroup", { name: "Accent color" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("radio")).toHaveCount(PALETTE.length);
  for (const [index, name] of PALETTE.entries()) {
    await expect(group.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  await expect(group.getByRole("radio", { name: "System" })).toBeChecked();
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

test("choosing an accent color applies it and saves one commit without the value", async ({
  page,
}) => {
  const commitsBefore = await commitMessages(page);
  const system = await rootAccent(page);
  await openSettings(page);
  const dialog = settingsDialog(page);

  await chooseAccent(page, "Teal");

  await expect(dialog.getByRole("radio", { name: "Teal" })).toBeChecked();
  await expectRootAccent(page, TEAL);
  await expect
    .poll(() =>
      dialog
        .locator(".dialog-card")
        .evaluate((el) => getComputedStyle(el).borderTopColor),
    )
    .toBe(TEAL);
  expect(TEAL).not.toBe(system);

  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = (await commitMessages(page)).filter(
    (m) => !commitsBefore.includes(m),
  );
  expect(added).toHaveLength(1);
  expect(added[0]).toContain("Commitnote-Settings: accentColor");
  expect(added[0].toLowerCase()).not.toContain("teal");
});

test("rapid accent changes are saved as a single commit", async ({ page }) => {
  const commitsBefore = await commitMessages(page);
  await openSettings(page);

  await chooseAccent(page, "Blue");
  await chooseAccent(page, "Red");
  await chooseAccent(page, "Teal");

  await expectSettingsCommits(page, commitsBefore.length + 1);
  await page.waitForTimeout(2500);
  expect(await commitMessages(page)).toHaveLength(commitsBefore.length + 1);
});

test("returning to the saved accent color or re-clicking it makes no commit", async ({
  page,
}) => {
  const commitsBefore = await commitMessages(page);
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await expectSettingsCommits(page, commitsBefore.length + 1);

  await chooseAccent(page, "Red");
  await chooseAccent(page, "Teal");
  await page.waitForTimeout(2500);
  expect(await commitMessages(page)).toHaveLength(commitsBefore.length + 1);

  await chooseAccent(page, "Teal");
  await page.waitForTimeout(2500);
  expect(await commitMessages(page)).toHaveLength(commitsBefore.length + 1);
});

test("choosing System after another accent restores the system accent", async ({
  page,
}) => {
  const system = await rootAccent(page);
  await openSettings(page);

  await chooseAccent(page, "Teal");
  await expectRootAccent(page, TEAL);

  await chooseAccent(page, "System");
  await expect(
    settingsDialog(page).getByRole("radio", { name: "System" }),
  ).toBeChecked();
  await expectRootAccent(page, system);
});

test("arrow keys move the accent color selection", async ({ page }) => {
  const system = await rootAccent(page);
  await openSettings(page);
  const dialog = settingsDialog(page);
  await expect(dialog.getByRole("radio", { name: "System" })).toBeFocused();

  await page.keyboard.press("ArrowRight");

  await expect(dialog.getByRole("radio", { name: "Blue" })).toBeChecked();
  await expect.poll(() => rootAccent(page)).not.toBe(system);
});

test("a saved accent color applies on the passphrase step and after login, and logout returns to system", async ({
  page,
}) => {
  const commitsBefore = await commitMessages(page);
  const system = await rootAccent(page);
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await expectRootAccent(page, TEAL);
  await expectSettingsCommits(page, commitsBefore.length + 1);
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);

  await clickLogOut(page);
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
  await expectRootAccent(page, system);

  await chooseRepository(page, { repo: NOTES_REPO });
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await expectRootAccent(page, TEAL);

  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
  await expectRootAccent(page, TEAL);
});
