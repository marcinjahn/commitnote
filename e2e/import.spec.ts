import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { strToU8, zipSync } from "fflate";
import { expectTree, logIn } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const REPO_KEY = "sample/notes";

function commitCount(page: Page): Promise<number> {
  return page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.commitMessages(repoKey).length,
    REPO_KEY,
  );
}

function zipOf(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) entries[path] = strToU8(text);
  return Buffer.from(zipSync(entries));
}

async function chooseArchive(
  page: Page,
  name: string,
  buffer: Buffer,
): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Import notes" })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: "application/zip", buffer });
}

function importDialog(page: Page) {
  return page.getByRole("dialog", { name: "Import notes" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
});

test("imports an archive into a new folder named after the file in one commit", async ({
  page,
}) => {
  const before = await commitCount(page);
  await chooseArchive(
    page,
    "Trip notes.zip",
    zipOf({
      "Packing.md": "# Packing\n",
      "Days/Monday.md": "# Monday\n",
      "photo.png": "not a note",
    }),
  );

  const dialog = importDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "A new folder" })).toBeChecked();
  await expect(dialog.getByLabel("Folder name")).toHaveValue("Trip notes");
  await expect(dialog.getByText("Imports 2 notes and 2 folders.")).toBeVisible();
  await expect(dialog.getByText(/^1 file will be skipped/)).toBeVisible();

  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Imported 2 notes and 2 folders.")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Trip notes" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Packing" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Days" })).toBeVisible();
  await expect.poll(() => commitCount(page)).toBe(before + 1);
});

test("stops on name conflicts, or renames the imported items when asked", async ({
  page,
}) => {
  const before = await commitCount(page);
  const archive = zipOf({ "Welcome.md": "# Imported welcome\n", "Fresh.md": "x" });

  await chooseArchive(page, "notes.zip", archive);
  let dialog = importDialog(page);
  await dialog.getByRole("radio", { name: "An existing folder" }).check();
  await expect(
    dialog.getByRole("radio", { name: "Notes (top level)" }),
  ).toBeChecked();
  await expect(dialog.getByText("Imports 2 notes and 0 folders.")).toBeVisible();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  const conflicts = page.getByRole("dialog", { name: "Name conflicts" });
  await expect(
    conflicts.getByText(
      "1 imported item has the same name as an item already in the destination.",
    ),
  ).toBeVisible();
  await expect(
    conflicts.getByRole("button", { name: "Rename imported items" }),
  ).toBeFocused();
  await expect(conflicts.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await conflicts.getByRole("button", { name: "Close" }).click();
  await expect(conflicts).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Fresh" })).toHaveCount(0);
  expect(await commitCount(page)).toBe(before);

  await chooseArchive(page, "notes.zip", archive);
  dialog = importDialog(page);
  await dialog.getByRole("radio", { name: "An existing folder" }).check();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Name conflicts" })
    .getByRole("button", { name: "Rename imported items" })
    .click();

  await expect(page.getByText("Imported 2 notes and 0 folders.")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Welcome (2)" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Welcome", exact: true })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Fresh" })).toBeVisible();
  await expect.poll(() => commitCount(page)).toBe(before + 1);
});

test("imports into an existing folder chosen with the keyboard", async ({
  page,
}) => {
  const before = await commitCount(page);
  await chooseArchive(page, "more.zip", zipOf({ "Later.md": "later" }));

  const dialog = importDialog(page);
  await dialog.getByRole("radio", { name: "A new folder" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    dialog.getByRole("radio", { name: "An existing folder" }),
  ).toBeChecked();
  await dialog.getByRole("radio", { name: "Projects" }).check();
  await dialog.getByRole("button", { name: "Import", exact: true }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Imported 1 note and 0 folders.")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Later" })).toBeVisible();
  await expect.poll(() => commitCount(page)).toBe(before + 1);
});

test("reports a file that isn't a zip archive", async ({ page }) => {
  const before = await commitCount(page);
  await chooseArchive(page, "broken.zip", Buffer.from("not a zip at all"));
  await expect(
    page.getByText("Couldn't import: the file is not a valid zip archive."),
  ).toBeVisible();
  await expect(importDialog(page)).toHaveCount(0);
  expect(await commitCount(page)).toBe(before);
});
