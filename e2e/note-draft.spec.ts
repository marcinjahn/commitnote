import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

const AUTO_NAME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

async function startSession(page: Page): Promise<void> {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
}

async function backToTreeIfMobile(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.project.name !== "mobile") return;
  await page.getByRole("button", { name: "Back to notes" }).click();
}

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
  await startSession(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expectEmptyDraft(page);
  if (testInfo.project.name === "desktop") {
    await expect(treeItem(page, "Fresh idea")).toHaveCount(0);
  }

  await nameField(page).fill("Fresh idea");
  await nameField(page).press("Enter");

  await expect(editor(page)).toBeFocused();
  await backToTreeIfMobile(page, testInfo);
  const created = treeItem(page, "Fresh idea");
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute("aria-selected", "true");
});

test("a draft opened from a folder row menu is created inside that folder", async ({
  page,
}, testInfo) => {
  await startSession(page);

  await page.getByRole("button", { name: "Actions for Projects" }).click();
  await page.getByRole("menuitem", { name: "New note…" }).click();
  await expectEmptyDraft(page);

  await nameField(page).fill("Sketch");
  await nameField(page).press("Enter");

  await expect(editor(page)).toBeFocused();
  await backToTreeIfMobile(page, testInfo);
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
}, testInfo) => {
  await startSession(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await nameField(page).fill("Blurred");
  await editor(page).click();

  await expect(nameField(page)).toHaveValue("Blurred");
  await backToTreeIfMobile(page, testInfo);
  const created = treeItem(page, "Blurred");
  await expect(created).toBeVisible();
  await expect(created).toHaveAttribute("aria-selected", "true");
});

test("typing content in a draft without a name creates the note with an automatic name", async ({
  page,
}, testInfo) => {
  await startSession(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await page.keyboard.type("Some thoughts");

  await expect(nameField(page)).toHaveValue(AUTO_NAME);
  await expect(editor(page)).toContainText("Some thoughts");

  await backToTreeIfMobile(page, testInfo);
  await expect(treeItem(page, AUTO_NAME)).toBeVisible();
});

test("an untouched draft disappears when it is left", async ({
  page,
}, testInfo) => {
  await startSession(page);
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
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
  expect(await treeItemNames(page)).toEqual(before);
});

test("a duplicate name in a draft shows an error and creates nothing", async ({
  page,
}, testInfo) => {
  await startSession(page);
  const before = await treeItemNames(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await nameField(page).fill("Welcome");
  await nameField(page).press("Enter");

  await expect(page.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );
  await backToTreeIfMobile(page, testInfo);
  expect(await treeItemNames(page)).toEqual(before);
});
