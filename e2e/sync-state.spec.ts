import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

test("Welcome shows a synced state in the tree and the note header", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  // Check the tree row before opening the note: on mobile, opening a note
  // hides the tree entirely.
  const welcomeItem = page.getByRole("treeitem", { name: "Welcome" });
  const welcomeRow = welcomeItem.locator("xpath=ancestor::li[1]");
  await expect(welcomeRow.getByRole("img", { name: "Synced" })).toBeVisible();

  await welcomeItem.click();

  const header = page.locator("header.note-header");
  await expect(header.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Welcome",
  );
  await expect(header.getByRole("img", { name: "Synced" })).toBeVisible();
});
