import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, SAMPLE, openNotes, fakeForge, onFakeForgeReady } from "./helpers";

const TRASH_REPO = "https://github.com/sample/trash";
const SAMPLE_TRASH_NOW = new Date("2026-09-30T12:00:00Z");

function treeItem(page: Page, name: string) {
  return page.getByRole("treeitem", { name, exact: true });
}

async function moveToTrash(
  page: Page,
  name: string,
  dialogText?: RegExp,
): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Move to trash?" }),
  ).toBeVisible();
  if (dialogText !== undefined) {
    await expect(dialog.getByText(dialogText)).toBeVisible();
  }
  await dialog
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function openTrash(page: Page) {
  await page.getByTestId("open-trash").click();
  const dialog = page.getByRole("dialog", { name: "Trash" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function restoreTo(
  page: Page,
  name: string,
  folder: string,
): Promise<void> {
  await page.getByRole("button", { name: `Restore ${name} to…`, exact: true }).click();
  const picker = page.getByRole("dialog", { name: /^Restore .* to folder$/ });
  await expect(picker).toBeVisible();
  await picker.getByRole("radio", { name: folder, exact: true }).check();
  await picker.getByRole("button", { name: "Restore", exact: true }).click();
}

test("the Trash button is hidden while the trash is empty", async ({
  page,
}) => {
  await openNotes(page);

  await expect(page.getByTestId("open-trash")).toHaveCount(0);
});

test("the Trash row sits below the tree and leaves the repo link visible", { tag: "@mobile" }, async ({
  page,
}) => {
  await openNotes(page);

  await moveToTrash(page, "Welcome");

  const trash = page.getByTestId("open-trash");
  await expect(trash).toBeVisible();
  const tree = page.getByRole("tree", { name: "Notes" });
  await expect(tree.getByTestId("open-trash")).toHaveCount(0);
  const treeBox = await tree.boundingBox();
  const trashBox = await trash.boundingBox();
  expect(treeBox).not.toBeNull();
  expect(trashBox).not.toBeNull();
  expect(trashBox!.y).toBeGreaterThanOrEqual(treeBox!.y + treeBox!.height);

  const repo = page
    .locator(".sidebar-footer")
    .getByRole("link", { name: /^sample\/notes / });
  await expect(repo).toBeVisible();
  expect(await repo.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await expect(page.locator(".sidebar-footer").getByTestId("open-trash")).toHaveCount(0);
});

test("a deleted note shows up in the trash and can be restored into a folder", async ({
  page,
}) => {
  await openNotes(page);

  await moveToTrash(page, "Welcome", /will be moved to the trash/);
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/);

  const dialog = await openTrash(page);
  await expect(page.getByTestId("trash-list")).toBeVisible();
  const rows = page.getByTestId("trash-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Welcome");
  await expect(rows.first()).toContainText("Notes (top level)");
  await expect(rows.first()).toContainText("30 days left");

  await restoreTo(page, "Welcome", "Projects");

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
  await treeItem(page, "Projects").click();
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("restoring into a folder that already has that name is refused", async ({
  page,
}) => {
  await openNotes(page);

  await moveToTrash(page, "Welcome");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Welcome");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(treeItem(page, "Welcome")).toBeVisible();

  await openTrash(page);
  await restoreTo(page, "Welcome", "Notes (top level)");

  const picker = page.getByRole("dialog", { name: /^Restore .* to folder$/ });
  await expect(picker.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );

  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId("trash-row")).toHaveCount(1);
});

test("a trashed folder expands and a sub-item can be restored on its own", async ({
  page,
}) => {
  await openNotes(page);

  await moveToTrash(page, "Journal", /and everything in it/);
  await expect(treeItem(page, "Journal")).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/);

  await openTrash(page);
  const rows = page.getByTestId("trash-row");
  await expect(rows).toHaveCount(1);

  await page.getByRole("button", { name: /^Journal/ }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: /^2026/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("January");

  await restoreTo(page, "January", "Notes (top level)");

  await expect(page.getByRole("dialog", { name: "Trash" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /^Restore/ })).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Trash" })
    .getByRole("button", { name: "Close" })
    .click();
  await expect(treeItem(page, "January")).toBeVisible();
  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/);
});

test("permanently deleting a trashed item needs confirmation", async ({
  page,
}) => {
  await openNotes(page);
  await moveToTrash(page, "Welcome");

  const trash = await openTrash(page);
  await page
    .getByRole("button", { name: "Delete Welcome permanently", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "Delete permanently?" });
  await expect(confirm).toBeVisible();

  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId("trash-row")).toHaveCount(1);

  await page
    .getByRole("button", { name: "Delete Welcome permanently", exact: true })
    .click();
  await confirm
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();

  await expect(trash).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
});

test("emptying the trash needs confirmation", async ({ page }) => {
  await openNotes(page);
  await moveToTrash(page, "Welcome");
  await moveToTrash(page, "Journal");
  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(2\)/);

  const trash = await openTrash(page);
  await page.getByTestId("empty-trash").click();
  const confirm = page.getByRole("dialog", { name: "Empty trash?" });
  await expect(confirm).toContainText("2 items will be deleted permanently.");

  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("trash-row")).toHaveCount(2);

  await page.getByTestId("empty-trash").click();
  await confirm
    .getByRole("button", { name: "Empty trash", exact: true })
    .click();

  await expect(trash).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
});

test("deleting an empty folder is permanent and leaves no trash", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "Actions for Empty folder" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Delete folder?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(treeItem(page, "Empty folder")).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
});

test("startup purges expired trash and keeps fresh entries", async ({
  page,
}) => {
  await page.clock.setFixedTime(SAMPLE_TRASH_NOW);
  await openNotes(page, { repo: TRASH_REPO });

  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/, {
    timeout: 15_000,
  });
  await expect
    .poll(
      () =>
        fakeForge(page, "sample/trash")
          .commitMessages()
          .then(
            (messages) =>
              messages.filter((message) => message.includes("Commitnote-Purge"))
                .length,
          ),
      { timeout: 15_000 },
    )
    .toBe(1);

  await openTrash(page);
  const rows = page.getByTestId("trash-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Scratch");
  await expect(rows.first()).toContainText("27 days left");
  await expect(page.getByText("Old meeting")).toHaveCount(0);
  await expect(page.getByText("Drafts")).toHaveCount(0);
});

async function startTrashSessionWithFailingPurge(page: Page): Promise<void> {
  const purgeFailed = page.waitForEvent("console", {
    predicate: (message) => message.text().includes("Trash purge failed"),
    timeout: 15_000,
  });
  await onFakeForgeReady(
    page,
    (controls, repoKey) => controls.failNext(repoKey, "commit", "Network"),
    "sample/trash",
  );
  await openNotes(page, { repo: TRASH_REPO });
  await purgeFailed;
}

test("expired entries stay hidden when the startup purge fails", async ({
  page,
}) => {
  await page.clock.setFixedTime(SAMPLE_TRASH_NOW);
  await startTrashSessionWithFailingPurge(page);

  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/);
  await openTrash(page);
  const rows = page.getByTestId("trash-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Scratch");
  await expect(page.getByText("Old meeting")).toHaveCount(0);
  await expect(page.getByText("Drafts")).toHaveCount(0);

  await page.getByTestId("empty-trash").click();
  await expect(page.getByRole("dialog", { name: "Empty trash?" })).toContainText(
    "1 item will be deleted permanently.",
  );
});

test("no Trash button when every entry expired and the startup purge fails", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-15T12:00:00Z"));
  await startTrashSessionWithFailingPurge(page);

  await expect(page.getByTestId("open-trash")).toHaveCount(0);
});

function moveToTrashToast(page: Page) {
  return page.getByRole("group").filter({ hasText: "moved to trash" });
}

test("Undo in the toast puts a deleted note back", async ({ page }) => {
  await openNotes(page);

  await moveToTrash(page, "Welcome");

  const toast = moveToTrashToast(page);
  await expect(toast).toContainText("“Welcome” moved to trash");
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
  await toast.getByRole("button", { name: "Undo" }).click();

  await expect(treeItem(page, "Welcome")).toBeVisible();
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
  await expect(toast).toHaveCount(0);
});

test("Undo after the trash was saved restores the note to its folder", async ({
  page,
}) => {
  await openNotes(page, { via: "login" });
  await page.getByRole("treeitem", { name: "Journal", exact: true }).click();
  const before = await page.getByRole("treeitem").allInnerTexts();

  await moveToTrash(page, "Projects");
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/);
  await moveToTrashToast(page).getByRole("button", { name: "Undo" }).click();

  await expect(treeItem(page, "Projects")).toBeVisible();
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
  await page.waitForTimeout(1_000);
  await page.reload();
  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);
  await expect(treeItem(page, "Projects")).toBeVisible();
  await expect(page.getByTestId("open-trash")).toHaveCount(0);
  expect(before.length).toBeGreaterThan(0);
});

test("the trash toast disappears by itself after a few seconds", async ({
  page,
}) => {
  await openNotes(page);
  await page.clock.install();

  await moveToTrash(page, "Welcome");
  await page.mouse.move(0, 0);
  const toast = moveToTrashToast(page);
  await expect(toast).toBeVisible();

  await page.clock.runFor(7_000);
  await expect(toast).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(toast).toHaveCount(0);
  await expect(page.getByTestId("open-trash")).toHaveText(/Trash \(1\)/);
});

test("a newer trash toast replaces the previous one", async ({ page }) => {
  await openNotes(page);

  await moveToTrash(page, "Welcome");
  await moveToTrash(page, "Zażółć gęślą jaźń");

  await expect(moveToTrashToast(page)).toHaveCount(1);
  await expect(moveToTrashToast(page)).toContainText("Zażółć gęślą jaźń");
});

test("the Trash dialog closes from its corner close button and from Escape", { tag: "@mobile" }, async ({
  page,
}) => {
  await page.clock.setFixedTime(SAMPLE_TRASH_NOW);
  await openNotes(page, { repo: TRASH_REPO });

  let dialog = await openTrash(page);
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(close).toBeFocused();
  const closeBox = await close.boundingBox();
  const headingBox = await dialog.getByRole("heading", { name: "Trash" }).boundingBox();
  expect(closeBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(closeBox!.x).toBeGreaterThan(headingBox!.x + headingBox!.width);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);

  dialog = await openTrash(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
