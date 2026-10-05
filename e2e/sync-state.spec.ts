import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";


test("a synced note shows no sync state in its row or header", async ({
  page,
}) => {
  await openNotes(page);

  // Check the tree row before opening the note: on mobile, opening a note
  // hides the tree entirely.
  const welcomeItem = page.getByRole("treeitem", { name: "Welcome" });
  const welcomeRow = welcomeItem.locator("xpath=ancestor::li[1]");
  await expect(welcomeRow.getByRole("img")).toHaveCount(0);

  await welcomeItem.click();

  const header = page.locator("header.note-header");
  await expect(header.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Welcome",
  );
  await expect(header.getByRole("img")).toHaveCount(0);
  await expect(header).not.toContainText("Synced");
});
