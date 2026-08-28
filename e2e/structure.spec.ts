import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

// Opening a note hides the tree entirely on phones (covered by its own test
// elsewhere), so tests that keep acting on tree rows after opening a note
// must return to the tree first.
async function backToTreeIfMobile(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.project.name !== "mobile") return;
  await page.getByRole("button", { name: "Back to notes" }).click();
}

// The sync icon sits next to the treeitem button, not inside it, and a
// folder's own icon must be told apart from its (possibly visible) children's.
function syncIconFor(page: Page, name: string) {
  return page
    .getByRole("treeitem", { name })
    .locator("xpath=following-sibling::span[1]")
    .getByRole("img");
}

test("creating, renaming, moving and deleting through row menus", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  // Create a folder at the top level.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Recipes");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "Recipes" })).toBeVisible();

  // Create a note inside it through its row menu; it opens in the editor.
  await page.getByRole("button", { name: "Actions for Recipes" }).click();
  await page.getByRole("menuitem", { name: "New note…" }).click();
  const firstName = page.getByRole("textbox", { name: "Note name" });
  await firstName.fill("Idea One");
  await firstName.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
  await backToTreeIfMobile(page, testInfo);

  await expect(syncIconFor(page, "Recipes")).toHaveCount(0);

  // A second note in the same folder, so there is a sibling name to collide
  // with when renaming below.
  await page.getByRole("button", { name: "Actions for Recipes" }).click();
  await page.getByRole("menuitem", { name: "New note…" }).click();
  const secondName = page.getByRole("textbox", { name: "Note name" });
  await secondName.fill("Idea Two");
  await secondName.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
  await backToTreeIfMobile(page, testInfo);

  // A note has no rename item in its row menu, a folder does.
  await page.getByRole("button", { name: "Actions for Idea Two" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Actions for Recipes" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Rename it in the note header; an existing sibling name and an
  // over-the-cap name are both rejected.
  await page.getByRole("treeitem", { name: "Idea Two" }).click();
  const renameInput = page.getByRole("textbox", { name: "Note name" });

  await renameInput.fill("Idea One");
  await renameInput.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );

  await renameInput.fill("a".repeat(151));
  await renameInput.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "Names can be at most 150 bytes. Some characters, like accented letters or emoji, count as more than one byte.",
  );

  await renameInput.fill("Grocery List");
  await renameInput.press("Enter");
  await backToTreeIfMobile(page, testInfo);
  await expect(
    page.getByRole("treeitem", { name: "Grocery List" }),
  ).toBeVisible();
  await expect(syncIconFor(page, "Grocery List")).toHaveCount(0);

  // Move it to the top level.
  await page.getByRole("button", { name: "Actions for Grocery List" }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page.getByRole("radio", { name: "Notes (top level)" }).check();
  await page.getByRole("button", { name: "Move" }).click();
  await expect(syncIconFor(page, "Grocery List")).toHaveCount(0);

  // Delete it after confirming.
  await page.getByRole("button", { name: "Actions for Grocery List" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByRole("treeitem", { name: "Grocery List" }),
  ).toHaveCount(0);

  // Deleting a non-empty folder (it still holds "Idea One") warns first.
  await page.getByRole("button", { name: "Actions for Recipes" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByText(/is not empty/)).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("treeitem", { name: "Recipes" })).toHaveCount(0);

  // Everything settles back to synced afterwards.
  await expect(syncIconFor(page, "Welcome")).toHaveCount(0);
});

test("right-click on a row opens its menu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only context menu");

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page
    .getByRole("treeitem", { name: "Welcome" })
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Actions for Welcome" }),
  ).toBeVisible();
});

test("the row actions button toggles its menu", async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  const button = page.getByRole("button", { name: "Actions for Welcome" });
  await button.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await button.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});
