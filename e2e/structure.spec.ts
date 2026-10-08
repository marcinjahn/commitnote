import { test, expect } from "./fixtures";
import { rowSyncState, openNotes, showTree } from "./helpers";
import { openRowMenu, rowActionsButton } from "./helpers/tree";

// Opening a note hides the tree entirely on phones (covered by its own test
// elsewhere), so tests that keep acting on tree rows after opening a note
// must return to the tree first.
test("creating, renaming, moving and deleting through row menus", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Recipes");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "Recipes" })).toBeVisible();

  await openRowMenu(page, "Recipes");
  await page.getByRole("menuitem", { name: "New note…" }).click();
  const firstName = page.getByRole("textbox", { name: "Note name" });
  await firstName.fill("Idea One");
  await firstName.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
  await showTree(page);

  await expect(rowSyncState(page, "Recipes")).toHaveCount(0);

  // A second note in the same folder, so there is a sibling name to collide
  // with when renaming below.
  await openRowMenu(page, "Recipes");
  await page.getByRole("menuitem", { name: "New note…" }).click();
  const secondName = page.getByRole("textbox", { name: "Note name" });
  await secondName.fill("Idea Two");
  await secondName.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
  await showTree(page);

  // A note has no rename item in its row menu, a folder does.
  await openRowMenu(page, "Idea Two");
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await openRowMenu(page, "Recipes");
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
  await showTree(page);
  await expect(
    page.getByRole("treeitem", { name: "Grocery List" }),
  ).toBeVisible();
  await expect(rowSyncState(page, "Grocery List")).toHaveCount(0);

  await openRowMenu(page, "Grocery List");
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page
    .getByRole("radiogroup", { name: "Folder" })
    .getByRole("radio", { name: "Projects", exact: true })
    .check();
  await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  const grocery = page.getByRole("treeitem", { name: "Grocery List", exact: true });
  if ((await grocery.count()) === 0) {
    await page.getByRole("treeitem", { name: "Projects", exact: true }).click();
  }
  await expect(grocery).toBeVisible();
  await expect(rowSyncState(page, "Grocery List", { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });

  await openRowMenu(page, "Grocery List");
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await expect(page.getByRole("dialog").getByRole("radio").first()).toBeFocused();
  await page.getByRole("radio", { name: "Notes (top level)" }).check();
  await page.getByRole("button", { name: "Move" }).click();
  await expect(rowSyncState(page, "Grocery List")).toHaveCount(0);

  await openRowMenu(page, "Grocery List");
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  await expect(page.getByRole("heading", { name: "Move to trash?" })).toBeVisible();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(
    page.getByRole("treeitem", { name: "Grocery List" }),
  ).toHaveCount(0);

  // Deleting a non-empty folder (it still holds "Idea One") moves it to the trash.
  await openRowMenu(page, "Recipes");
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  await expect(page.getByText(/and everything in it/)).toBeVisible();
  await page.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "Recipes" })).toHaveCount(0);

  await expect(rowSyncState(page, "Welcome")).toHaveCount(0);
  await expect(rowSyncState(page, "Projects", { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("right-click on a row opens its menu", async ({ page }) => {
  await openNotes(page);

  await page
    .getByRole("treeitem", { name: "Welcome" })
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Actions for Welcome" }),
  ).toBeVisible();
});

test("Shift+F10 and the ContextMenu key open the focused row's menu and Escape returns to the row", async ({
  page,
}) => {
  await openNotes(page);
  const row = page.getByRole("treeitem", { name: "Welcome" });
  const menu = page.getByRole("menu", { name: "Actions for Welcome" });

  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "No color" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();

  await page.keyboard.press("ContextMenu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("the row actions button toggles its menu", { tag: "@mobile" }, async ({ page }) => {
  await openNotes(page);

  const button = rowActionsButton(page, "Welcome");
  await button.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await button.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a rejected folder name is announced as the field's description", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Recipes");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: "Recipes" })).toBeVisible();

  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog");
  const folderName = dialog.getByRole("textbox", { name: "Folder name" });
  await expect(folderName).toHaveAccessibleDescription("");
  await expect(folderName).not.toHaveAttribute("aria-invalid", /.*/);

  await folderName.fill("Recipes");
  await expect(folderName).toHaveAttribute("aria-invalid", "true");
  await expect(folderName).toHaveAccessibleDescription(
    "A note or folder with this name already exists here.",
  );
});
