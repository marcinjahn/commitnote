import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { strToU8, zipSync } from "fflate";
import { openNotes, fakeForge } from "./helpers";
import { openDataSecurityAction, settingsDialog } from "./helpers/settings";


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
  await openDataSecurityAction(page, "Import notes");
  const chooser = await chooserPromise;
  await chooser.setFiles({ name, mimeType: "application/zip", buffer });
}

function importDialog(page: Page) {
  return page.getByRole("dialog", { name: "Import notes" });
}

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("imports an archive into a new folder named after the file in one commit", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();
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
  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
});

test("stops on name conflicts, or renames the imported items when asked", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();
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
  expect(await fakeForge(page).commitCount()).toBe(before);

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
  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
});

test("imports into an existing folder chosen with the keyboard", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();
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
  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
});

test("reports a file that isn't a zip archive", async ({ page }) => {
  const before = await fakeForge(page).commitCount();
  await chooseArchive(page, "broken.zip", Buffer.from("not a zip at all"));
  await expect(
    page.getByText("Couldn't import: the file is not a valid zip archive."),
  ).toBeVisible();
  await expect(importDialog(page)).toHaveCount(0);
  expect(await fakeForge(page).commitCount()).toBe(before);
});

test("closing Import notes with Escape keeps Settings open and refocuses its button", async ({
  page,
}) => {
  await chooseArchive(page, "Trip notes.zip", zipOf({ "a.md": "# A" }));
  await expect(importDialog(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(importDialog(page)).toHaveCount(0);
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Import notes", exact: true }),
  ).toBeFocused();
});

test("importing loose Markdown files from the picker adds them as root notes", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();
  const chooserPromise = page.waitForEvent("filechooser");
  await openDataSecurityAction(page, "Import notes");
  const chooser = await chooserPromise;
  await chooser.setFiles([
    { name: "First.md", mimeType: "text/markdown", buffer: Buffer.from("First\n") },
    { name: "Second.md", mimeType: "text/markdown", buffer: Buffer.from("Second\n") },
  ]);

  await expect(page.getByText("Imported 2 notes.")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "First" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Second" })).toBeVisible();
  await expect.poll(() => fakeForge(page).commitCount()).toBe(before + 1);
});

test("rejects a picker selection that mixes a zip archive with other files", async ({
  page,
}) => {
  const before = await fakeForge(page).commitCount();
  const chooserPromise = page.waitForEvent("filechooser");
  await openDataSecurityAction(page, "Import notes");
  const chooser = await chooserPromise;
  await chooser.setFiles([
    {
      name: "notes.zip",
      mimeType: "application/zip",
      buffer: zipOf({ "a.md": "# A" }),
    },
    { name: "Extra.md", mimeType: "text/markdown", buffer: Buffer.from("Extra\n") },
  ]);

  await expect(
    page.getByText("Choose one .zip archive, or Markdown and text files."),
  ).toBeVisible();
  await expect(importDialog(page)).toHaveCount(0);
  expect(await fakeForge(page).commitCount()).toBe(before);
});
