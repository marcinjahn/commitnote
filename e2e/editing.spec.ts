import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

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

test("editing the note autosaves, and the edit is there after reopening it", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" extra");

  const header = page.locator("header.note-header");
  const syncIcon = header.getByRole("img");
  await expect(syncIcon).not.toHaveAccessibleName("Synced");
  await expect(syncIcon).toHaveAccessibleName("Synced", { timeout: 10_000 });

  const backButton = page.getByRole("button", { name: "Back to notes" });
  const isMobile = testInfo.project.name === "mobile";
  if (isMobile) await backButton.click();
  await page.getByRole("treeitem", { name: "Zażółć gęślą jaźń" }).click();
  if (isMobile) await backButton.click();
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText("extra");
});
