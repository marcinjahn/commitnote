import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { strFromU8, unzipSync } from "fflate";
import { openNotes, fakeForge } from "./helpers";

const KEY_CHANGED_TEXT =
  "The passphrase was changed on another device. Log in again.";

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("an edit after a passphrase change elsewhere is kept for export and never saved", async ({
  page,
}) => {
  await fakeForge(page).changeRepoKey();
  const commitsAfterChange = await fakeForge(page).commitCount();

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" typed with the old key");

  await expect(page.getByRole("alert").getByText(KEY_CHANGED_TEXT)).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.getByText("1 note or folder was not saved")).toBeVisible();
  await expect(page.getByRole("tree", { name: "Notes" })).toHaveCount(0);
  expect(await fakeForge(page).commitCount()).toBe(commitsAfterChange);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export unsaved notes" }).click();
  const download = await downloadPromise;
  const files = unzipSync(await readFile(await download.path()));
  expect(strFromU8(files["Welcome.md"])).toContain("typed with the old key");

  await page.getByRole("button", { name: "Log in again" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible();
  expect(await fakeForge(page).commitCount()).toBe(commitsAfterChange);
});

test("a refresh after a passphrase change elsewhere asks to log in again", async ({
  page,
}) => {
  await fakeForge(page).changeRepoKey();
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(
    page.getByRole("alert").getByText(KEY_CHANGED_TEXT),
  ).toBeVisible();
  await expect(
    page.getByText("All your changes were saved before this happened."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log in again" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible();
});
