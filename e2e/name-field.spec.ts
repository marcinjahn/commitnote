import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree, flushPendingSaves } from "./helpers";
import { headerSyncIcon, openWelcome, treeItem } from "./helpers/tree";


function nameField(page: Page) {
  return page.getByRole("textbox", { name: "Note name" });
}

test("renaming a note with Enter updates the tree and syncs", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);

  await nameField(page).fill("Greetings");
  await nameField(page).press("Enter");

  await expect(nameField(page)).toHaveValue("Greetings");
  await flushPendingSaves(page);
  await expect(headerSyncIcon(page)).toHaveCount(0, {
    timeout: 10_000,
  });
  await showTree(page);
  await expect(treeItem(page, "Greetings")).toBeVisible();
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
});

test("Escape in the name field restores the previous name", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);

  await nameField(page).fill("Something else");
  await nameField(page).press("Escape");

  await expect(nameField(page)).toHaveValue("Welcome");
  await showTree(page);
  await expect(treeItem(page, "Welcome")).toBeVisible();
  await expect(treeItem(page, "Something else")).toHaveCount(0);
});

test("clearing the name field and leaving it restores the previous name", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);

  await nameField(page).fill("");
  await nameField(page).blur();

  await expect(nameField(page)).toHaveValue("Welcome");
  await showTree(page);
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("renaming a note to an existing name shows an error and keeps the name", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);

  await nameField(page).fill("Journal");
  await nameField(page).press("Enter");

  await expect(page.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );
  await showTree(page);
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("a note's row menu has no Rename item but a folder's has", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "Actions for Welcome" }).click();
  await expect(page.getByRole("menuitem", { name: "Move to trash…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Actions for Projects" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
});
