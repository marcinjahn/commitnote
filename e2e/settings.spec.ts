import type { Page, TestInfo } from "@playwright/test";
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

const SEEDED_ROOT = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

const NOTE_OPTIONS = ["At the beginning", "At the end"];
const FOLDER_OPTIONS = ["At the beginning", "At the end", "After the last folder"];

function rootRows(page: Page) {
  return page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
}

async function chooseOption(
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

async function addedCommits(
  page: Page,
  before: string[],
): Promise<string[]> {
  return (await commitMessages(page)).filter((m) => !before.includes(m));
}

async function createHeaderNote(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill(name);
  await field.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to notes" }).click();
  }
  await expect(page.getByRole("treeitem", { name })).toBeVisible();
}

async function createHeaderFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("treeitem", { name })).toBeVisible();
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
  await expect(group.getByRole("radio", { name: "System" })).toBeFocused();

  const sections = dialog.getByRole("radiogroup");
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(1)).toHaveAccessibleName("New notes");
  await expect(sections.nth(2)).toHaveAccessibleName("New folders");
  const notes = dialog.getByRole("radiogroup", { name: "New notes" });
  const folders = dialog.getByRole("radiogroup", { name: "New folders" });
  await expect(notes.getByRole("radio")).toHaveCount(NOTE_OPTIONS.length);
  for (const [index, name] of NOTE_OPTIONS.entries()) {
    await expect(notes.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  await expect(notes.getByRole("radio", { name: "At the beginning" })).toBeChecked();
  await expect(folders.getByRole("radio")).toHaveCount(FOLDER_OPTIONS.length);
  for (const [index, name] of FOLDER_OPTIONS.entries()) {
    await expect(folders.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  await expect(folders.getByRole("radio", { name: "At the end" })).toBeChecked();

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

test("a saved note placement is one commit naming only the key, and returning to it makes no commit", async ({
  page,
}) => {
  const commitsBefore = await commitMessages(page);
  await openSettings(page);

  await chooseOption(page, "New notes", "At the end");
  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = await addedCommits(page, commitsBefore);
  expect(added).toHaveLength(1);
  expect(added[0].split("\n")).toContain("Commitnote-Settings: newNotePlacement");

  await chooseOption(page, "New notes", "At the beginning");
  await chooseOption(page, "New notes", "At the end");
  await page.waitForTimeout(2500);
  expect(await commitMessages(page)).toHaveLength(commitsBefore.length + 1);
});

test("a saved folder placement is one commit naming only the key", async ({
  page,
}) => {
  const commitsBefore = await commitMessages(page);
  await openSettings(page);

  await chooseOption(page, "New folders", "After the last folder");
  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = await addedCommits(page, commitsBefore);
  expect(added).toHaveLength(1);
  expect(added[0].split("\n")).toContain(
    "Commitnote-Settings: newFolderPlacement",
  );
  expect(added[0]).not.toContain("afterLastFolder");
});

test("by default a new note is first and a new folder is last at the root", async ({
  page,
}, testInfo) => {
  await createHeaderNote(page, testInfo, "Fresh note");
  await createHeaderFolder(page, "Fresh folder");

  await expect(rootRows(page)).toHaveText([
    "Fresh note",
    ...SEEDED_ROOT,
    "Fresh folder",
  ]);
});

test("changed placements apply to items created right after closing Settings", async ({
  page,
}, testInfo) => {
  await openSettings(page);
  await chooseOption(page, "New notes", "At the end");
  await chooseOption(page, "New folders", "After the last folder");
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);

  await createHeaderNote(page, testInfo, "Fresh note");
  await createHeaderFolder(page, "Fresh folder");

  await expect(rootRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "Projects",
    "Fresh folder",
    "Welcome",
    "Zażółć gęślą jaźń",
    "Fresh note",
  ]);
});

test("arrow keys move the note placement selection", async ({ page }) => {
  await openSettings(page);
  const group = settingsDialog(page).getByRole("radiogroup", {
    name: "New notes",
  });
  await group.getByRole("radio", { name: "At the beginning" }).focus();

  await page.keyboard.press("ArrowDown");

  await expect(group.getByRole("radio", { name: "At the end" })).toBeChecked();
});
