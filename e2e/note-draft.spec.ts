import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, SAMPLE, openNotes, showTree } from "./helpers";


const AUTO_NAME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function nameField(page: Page) {
  return page.getByRole("textbox", { name: "Note name" });
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Note editor" });
}

function treeItem(page: Page, name: string | RegExp) {
  return page.getByRole("treeitem", { name, exact: true });
}

async function treeItemNames(page: Page): Promise<string[]> {
  return page.getByRole("treeitem").allTextContents();
}

async function expectEmptyDraft(page: Page): Promise<void> {
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveValue("");
  await expect(editor(page)).toHaveText("");
}

test("a draft opened from the header button is created by typing a name and pressing Enter", async ({
  page,
}, testInfo) => {
  await openNotes(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expectEmptyDraft(page);
  if (testInfo.project.name === "desktop") {
    await expect(treeItem(page, "Fresh idea")).toHaveCount(0);
  }

  await nameField(page).fill("Fresh idea");
  await nameField(page).press("Enter");

  await expect(editor(page)).toBeFocused();
  await showTree(page);
  const created = treeItem(page, "Fresh idea");
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute("aria-selected", "true");
});

test("the empty note pane offers a link that opens a draft", async ({
  page,
}) => {
  await openNotes(page);

  await expect(page.getByText("Select a note to read it, or")).toBeVisible();
  await page.getByRole("button", { name: "create a new note" }).click();

  await expectEmptyDraft(page);
});

test("a draft opened from a folder row menu is created inside that folder", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "Actions for Projects" }).click();
  await page.getByRole("menuitem", { name: "New note…" }).click();
  await expectEmptyDraft(page);

  await nameField(page).fill("Sketch");
  await nameField(page).press("Enter");

  await expect(editor(page)).toBeFocused();
  await showTree(page);
  await expect(treeItem(page, "Projects")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const created = treeItem(page, "Sketch");
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute("aria-selected", "true");
  await expect(treeItem(page, "commitnote")).toBeVisible();
});

test("leaving the name field with a valid name creates the note", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await nameField(page).fill("Blurred");
  await editor(page).click();

  await expect(nameField(page)).toHaveValue("Blurred");
  await showTree(page);
  const created = treeItem(page, "Blurred");
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute("aria-selected", "true");
});

test("typing content in a draft without a name creates the note with an automatic name", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await page.keyboard.type("Some thoughts");

  await expect(nameField(page)).toHaveValue(AUTO_NAME);
  await expect(editor(page)).toContainText("Some thoughts");

  await showTree(page);
  await expect(treeItem(page, AUTO_NAME)).toBeVisible();
});

test("an untouched draft disappears when it is left", { tag: "@mobile" }, async ({
  page,
}, testInfo) => {
  await openNotes(page, { via: "login" });
  const before = await treeItemNames(page);
  const newNote = page.getByRole("button", { name: "New note", exact: true });

  await newNote.click();
  await expectEmptyDraft(page);

  if (testInfo.project.name === "desktop") {
    await treeItem(page, "Welcome").click();
    await expect(nameField(page)).toHaveValue("Welcome");

    await newNote.click();
    await expectEmptyDraft(page);
    await newNote.click();
    await expectEmptyDraft(page);
  } else {
    await page.getByRole("button", { name: "Back to notes" }).click();
    await newNote.click();
    await expectEmptyDraft(page);
    await page.getByRole("button", { name: "Back to notes" }).click();
  }

  await expect(treeItem(page, "Welcome")).toBeVisible();
  expect(await treeItemNames(page)).toEqual(before);

  await page.reload();
  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);
  expect(await treeItemNames(page)).toEqual(before);
});

test("undo in a new draft does not restore the previous note", async ({
  page,
}) => {
  await openNotes(page);
  const before = await treeItemNames(page);
  await treeItem(page, "Welcome").click();
  await expect(nameField(page)).toHaveValue("Welcome");
  const newNote = page.getByRole("button", { name: "New note", exact: true });

  if (!(await newNote.isVisible())) await showTree(page);
  await newNote.click();
  await expectEmptyDraft(page);

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.waitForTimeout(1000);

  await expect(nameField(page)).toHaveValue("");
  await expect(editor(page)).toHaveText("");
  await showTree(page);
  expect(await treeItemNames(page)).toEqual(before);
});

test("a duplicate name in a draft shows an error and creates nothing", async ({
  page,
}) => {
  await openNotes(page);
  const before = await treeItemNames(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await nameField(page).fill("Welcome");
  await nameField(page).press("Enter");

  await expect(page.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );
  await showTree(page);
  expect(await treeItemNames(page)).toEqual(before);
});
