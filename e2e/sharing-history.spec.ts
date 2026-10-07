import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  KEY_DERIVATION_TIMEOUT,
  SAMPLE,
  expectTree,
  handOverRepo,
  logIn,
  openNotes,
} from "./helpers";
import {
  moveToTrash,
  openHistory,
  openTrash,
  openWelcome,
  restoreTo,
  treeItem,
  waitForSynced,
} from "./helpers/tree";

const NOTE_TEXT = "Notes stay private even to the forge that hosts them.";
const OTHER_NOTE = "Zażółć gęślą jaźń";
const NEW_PASSPHRASE = "a brand new passphrase";

async function shareFromRowMenu(page: Page, name = "Welcome"): Promise<string> {
  await treeItem(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: `Share “${name}”` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
  const value = await link.inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return value;
}

async function openSharedLinks(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Shared links" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Shared links" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeSharedLinks(list: Locator): Promise<void> {
  await list.page().keyboard.press("Escape");
  await expect(list).toHaveCount(0);
}

async function shareAction(list: Locator, title: string, item: string): Promise<void> {
  await list.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await list.getByRole("button", { name: `Share actions for ${title}` }).click();
  await list.page().getByRole("menu", { name: `Share actions for ${title}` }).getByRole("menuitem", { name: item }).click();
}

async function revoke(page: Page, list: Locator, title: string): Promise<void> {
  await shareAction(list, title, "Revoke…");
  await page
    .getByRole("dialog", { name: "Revoke link?" })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(page.getByText("Link revoked")).toBeVisible();
}

async function openViewer(page: Page, link: string): Promise<Page> {
  const viewer = await page.context().newPage();
  await viewer.goto(link);
  return viewer;
}

async function changePassphrase(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Change passphrase" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Change passphrase" });
  await dialog.getByLabel("Current passphrase").fill(SAMPLE.passphrase);
  await dialog.getByLabel("New passphrase", { exact: true }).fill(NEW_PASSPHRASE);
  await dialog.getByLabel("Repeat new passphrase").fill(NEW_PASSPHRASE);
  await dialog.getByRole("button", { name: "Continue" }).click();
  const review = page.getByRole("dialog", { name: "Ready to change passphrase" });
  await expect(review).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
  await review.getByRole("button", { name: "Change passphrase" }).click();
  await expect(page.getByText("Passphrase changed.")).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expectTree(page);
}

test("the shared version shows the text from when the note was shared", async ({ page }) => {
  await openNotes(page);
  await shareFromRowMenu(page);

  await openWelcome(page);
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Edited after sharing");
  await waitForSynced(page);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "View shared version");
  const version = page.getByRole("dialog", { name: "Shared version" });
  await expect(version.getByText(NOTE_TEXT)).toBeVisible();
  await expect(version.getByText("Edited after sharing")).toHaveCount(0);
});

test("a share survives a passphrase change", async ({ page }) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page);

  await changePassphrase(page);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "View shared version");
  const version = page.getByRole("dialog", { name: "Shared version" });
  await expect(
    version.getByText(
      "The shared version is no longer in your history. Your passphrase was changed after this note was shared. The link still works.",
    ),
  ).toBeVisible();
  await version.getByRole("button", { name: "Close" }).click();
  await expect(version).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Share actions for Welcome" })).toBeVisible();
  await closeSharedLinks(list);

  const viewer = await openViewer(page, link);
  await expect(viewer.getByText(NOTE_TEXT)).toBeVisible();

  await expect(treeItem(page, "Welcome")).toHaveAccessibleDescription(/Shared/);
  await expect(treeItem(page, "Welcome").locator(".share-glyph")).toBeVisible();
});

test("the shared links list is available on a second device", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  const link = await shareFromRowMenu(page);
  await waitForSynced(page);

  const second = await openSecondDevice();
  await second.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(second.page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(second.page);
  await handOverRepo(page, second.page);
  await second.page.getByRole("button", { name: "Refresh" }).click();

  const list = await openSharedLinks(second.page);
  await expect(list.getByTestId("share-item")).toHaveCount(1);
  await shareAction(list, "Welcome", "Copy link");
  await expect(second.page.getByText("Link copied")).toBeVisible();
  expect(await second.page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await revoke(second.page, list, "Welcome");
  await waitForSynced(second.page);

  await expect(treeItem(page, "Welcome")).toHaveAccessibleDescription(/Shared/);
  await handOverRepo(second.page, page);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(treeItem(page, "Welcome")).not.toHaveAccessibleDescription(/Shared/);
  await expect(treeItem(page, "Welcome").locator(".share-glyph")).toHaveCount(0);
});

test("trashed and deleted notes stay in the shared links list", async ({ page }) => {
  await openNotes(page);
  await shareFromRowMenu(page);
  await shareFromRowMenu(page, OTHER_NOTE);

  await moveToTrash(page, "Welcome");
  let list = await openSharedLinks(page);
  const welcome = list.getByTestId("share-item").filter({ hasText: "Welcome" });
  await expect(welcome).toContainText("In trash");
  await closeSharedLinks(list);

  const trash = await openTrash(page);
  await restoreTo(page, "Welcome", "Notes (top level)");
  await expect(trash).toHaveCount(0);
  await expect(treeItem(page, "Welcome")).toHaveAccessibleDescription(/Shared/);
  await expect(treeItem(page, "Welcome").locator(".share-glyph")).toBeVisible();

  await moveToTrash(page, OTHER_NOTE);
  await openTrash(page);
  await page.getByRole("button", { name: `Delete ${OTHER_NOTE} permanently`, exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete permanently?" })
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Trash" })).toHaveCount(0);

  list = await openSharedLinks(page);
  const deleted = list.getByTestId("share-item").filter({ hasText: "Deleted note" });
  await expect(deleted).toContainText(OTHER_NOTE);
  await revoke(page, list, OTHER_NOTE);
  await expect(list.getByTestId("share-item")).toHaveCount(1);
});

test("the history Shared badge follows the shared version through update and revoke", async ({
  page,
}) => {
  await openNotes(page);
  await shareFromRowMenu(page);
  await openWelcome(page);
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Edited after sharing");
  await waitForSynced(page);

  const badge = (history: Locator) => history.locator(".shared-badge");
  const rows = (history: Locator) => history.getByTestId("version-row");

  let history = await openHistory(page);
  await expect(badge(history)).toHaveCount(1);
  await expect(rows(history).first().locator(".shared-badge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);

  const list = await openSharedLinks(page);
  await shareAction(list, "Welcome", "Update to current version");
  await expect(page.getByText("Link updated")).toBeVisible();
  await closeSharedLinks(list);

  history = await openHistory(page);
  await expect(badge(history)).toHaveCount(1);
  await expect(rows(history).first().locator(".shared-badge")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);

  const links = await openSharedLinks(page);
  await revoke(page, links, "Welcome");
  await closeSharedLinks(links);

  history = await openHistory(page);
  await expect(badge(history)).toHaveCount(0);
});
