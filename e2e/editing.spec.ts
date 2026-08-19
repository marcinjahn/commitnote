import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

// Matches the modifier key create-markdown-editor and AppShell expect for the
// Ctrl/Cmd+E shortcut on the machine actually running the browser.
const MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

test("opening a note shows the editor by default, unfocused", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Welcome");
  await expect(editor).not.toBeFocused();
});

test("editing the note autosaves, and the reading view reflects the change", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press(`${MODIFIER}+End`);
  await page.keyboard.type(" extra");

  const header = page.locator("header.note-header");
  const syncIcon = header.getByRole("img");
  await expect(syncIcon).not.toHaveAccessibleName("Synced");
  await expect(syncIcon).toHaveAccessibleName("Synced", { timeout: 10_000 });

  await page.getByRole("button", { name: "Reading view" }).click();
  const article = page.getByRole("article", { name: "Reading view" });
  await expect(article).toBeVisible();
  await expect(article).toContainText("extra");

  await page.getByRole("button", { name: "Reading view" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
});

test("the keyboard shortcut toggles the view", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only shortcut check");

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await page.getByRole("textbox", { name: "Note editor" }).click();

  await page.keyboard.press(`${MODIFIER}+e`);
  await expect(
    page.getByRole("article", { name: "Reading view" }),
  ).toBeVisible();

  await page.keyboard.press(`${MODIFIER}+e`);
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
});

test("switching notes keeps the chosen view (desktop)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only layout");

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await page.getByRole("button", { name: "Reading view" }).click();
  await expect(
    page.getByRole("article", { name: "Reading view" }),
  ).toBeVisible();

  await page.getByRole("treeitem", { name: "Zażółć gęślą jaźń" }).click();
  await expect(
    page.getByRole("article", { name: "Reading view" }),
  ).toBeVisible();
});

test("switching notes keeps the chosen view (mobile)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout");

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await page.getByRole("button", { name: "Reading view" }).click();
  await expect(
    page.getByRole("article", { name: "Reading view" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.getByRole("treeitem", { name: "Zażółć gęślą jaźń" }).click();
  await expect(
    page.getByRole("article", { name: "Reading view" }),
  ).toBeVisible();
});
