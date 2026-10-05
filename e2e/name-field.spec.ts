import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

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

function treeItem(page: Page, name: string) {
  return page.getByRole("treeitem", { name, exact: true });
}

function headerIcon(page: Page) {
  return page.locator("header.note-header").getByRole("img");
}

async function openWelcome(page: Page): Promise<void> {
  await treeItem(page, "Welcome").click();
  await expect(nameField(page)).toHaveValue("Welcome");
}

test("renaming a note with Enter updates the tree and syncs", async ({
  page,
}, testInfo) => {
  await startSession(page);
  await openWelcome(page);

  await nameField(page).fill("Greetings");
  await nameField(page).press("Enter");

  await expect(nameField(page)).toHaveValue("Greetings");
  await expect(headerIcon(page)).toHaveCount(0, {
    timeout: 10_000,
  });
  await backToTreeIfMobile(page, testInfo);
  await expect(treeItem(page, "Greetings")).toBeVisible();
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
});

test("Escape in the name field restores the previous name", async ({
  page,
}, testInfo) => {
  await startSession(page);
  await openWelcome(page);

  await nameField(page).fill("Something else");
  await nameField(page).press("Escape");

  await expect(nameField(page)).toHaveValue("Welcome");
  await backToTreeIfMobile(page, testInfo);
  await expect(treeItem(page, "Welcome")).toBeVisible();
  await expect(treeItem(page, "Something else")).toHaveCount(0);
});

test("clearing the name field and leaving it restores the previous name", async ({
  page,
}, testInfo) => {
  await startSession(page);
  await openWelcome(page);

  await nameField(page).fill("");
  await nameField(page).blur();

  await expect(nameField(page)).toHaveValue("Welcome");
  await backToTreeIfMobile(page, testInfo);
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("renaming a note to an existing name shows an error and keeps the name", async ({
  page,
}, testInfo) => {
  await startSession(page);
  await openWelcome(page);

  await nameField(page).fill("Journal");
  await nameField(page).press("Enter");

  await expect(page.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );
  await backToTreeIfMobile(page, testInfo);
  await expect(treeItem(page, "Welcome")).toBeVisible();
});

test("a note's row menu has no Rename item but a folder's has", async ({
  page,
}) => {
  await startSession(page);

  await page.getByRole("button", { name: "Actions for Welcome" }).click();
  await expect(page.getByRole("menuitem", { name: "Move to trash…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Actions for Projects" }).click();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
});
