import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, fakeForge, openNotes } from "./helpers";
import { hoverOnto, liftRow, release, treeItem } from "./helpers/tree";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

function trashButton(page: Page) {
  return page.getByTestId("open-trash");
}

async function dropOnTrash(page: Page, name: string): Promise<void> {
  await liftRow(page, treeItem(page, name));
  await hoverOnto(page, trashButton(page));
  await release(page);
}

async function shareFromRowMenu(page: Page, name: string): Promise<void> {
  await treeItem(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: `Share “${name}”` });
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("dropping a note on the trash button moves it to the trash", async ({
  page,
}) => {
  await expect(trashButton(page)).toHaveCount(0);

  await liftRow(page, treeItem(page, "Welcome"));
  await hoverOnto(page, trashButton(page));
  await expect(trashButton(page)).toHaveText("Trash");
  await expect(trashButton(page)).toHaveAttribute("data-trash-drop", /.*/);
  await expect(page.locator(".tree-drop-slot")).toBeHidden();
  await expect(page.locator("[data-drop-into]")).toHaveCount(0);
  await release(page);

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Move to trash?" }),
  ).toBeVisible();
  await expect(dialog.getByText("“Welcome” will be moved to the trash.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Trash", exact: true })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
  await expect(trashButton(page)).toHaveText(/Trash \(1\)/);
  const toast = page.getByRole("group").filter({ hasText: "moved to trash" });
  await expect(toast).toContainText("“Welcome” moved to trash");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("cancelling the dialog after a trash drop changes nothing", async ({
  page,
}) => {
  const commits = await fakeForge(page).commitCount();
  await dropOnTrash(page, "Welcome");

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Move to trash?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(treeItem(page, "Welcome")).toBeVisible();
  await expect(trashButton(page)).toHaveCount(0);
  await expect.poll(() => fakeForge(page).commitCount()).toBe(commits);
});

test("dropping a folder on the trash button moves it with its contents", async ({
  page,
}) => {
  await dropOnTrash(page, "Projects");

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Move to trash?" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("“Projects” and everything in it (3 items) will be moved to the trash."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Move to trash", exact: true }).click();

  await expect(treeItem(page, "Projects")).toHaveCount(0);
  await expect(trashButton(page)).toHaveText(/Trash \(1\)/);
});

test("the trash button appears only during a drag while the trash is empty", async ({
  page,
}) => {
  await expect(trashButton(page)).toHaveCount(0);
  await liftRow(page, treeItem(page, "Welcome"));
  await expect(trashButton(page)).toBeVisible();

  const journal = (await treeItem(page, "Journal").boundingBox())!;
  await page.mouse.move(journal.x + journal.width / 2, journal.y + journal.height * 0.25, {
    steps: 10,
  });
  await release(page);

  await expect(trashButton(page)).toHaveCount(0);
});

test("a failed revoke keeps a shared note out of the trash", async ({ page }) => {
  await shareFromRowMenu(page, "Welcome");
  await fakeForge(page).failNext("deleteShare", "Network");
  await dropOnTrash(page, "Welcome");

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("trash-share-warning")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Revoke links and move to trash", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Nothing was moved to the trash.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(treeItem(page, "Welcome")).toHaveAccessibleDescription(/Shared/);
  await expect(trashButton(page)).toHaveCount(0);
});
