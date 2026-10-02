import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const PASSPHRASE = "sample notes repo passphrase";

async function startSession(page: Page): Promise<void> {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
  await expectTree(page);
}

async function waitForSynced(page: Page): Promise<void> {
  await expect(page.locator("header.note-header").getByRole("img")).toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

async function appendText(page: Page, text: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
  await expect(
    page.locator("header.note-header").getByRole("img"),
  ).toBeVisible();
  await waitForSynced(page);
}

async function renameOpenNote(page: Page, name: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill(name);
  await field.press("Enter");
  await expect(
    page.locator("header.note-header").getByRole("img"),
  ).toBeVisible();
  await waitForSynced(page);
}

/** "Welcome" with a last line typed in three saves, then renamed to "Hello". */
async function noteWithHistory(page: Page): Promise<void> {
  await startSession(page);
  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  await appendText(page, "one");
  await appendText(page, " two");
  await appendText(page, " three");
  await renameOpenNote(page, "Hello");
}

async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Version history" }).click();
  const dialog = page.getByRole("dialog", { name: "Version history" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("history-end")).toHaveText("Note created.");
  return dialog;
}

test("lists the note's versions with an editing session and labels", async ({
  page,
}) => {
  await noteWithHistory(page);

  const dialog = await openHistory(page);

  const rows = dialog.getByTestId("version-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Current");
  await expect(rows.nth(0)).toContainText("Renamed from “Welcome”");
  await expect(rows.nth(1)).toContainText(" · 3 saves");
  await expect(rows.nth(1)).toContainText("Welcome");
  await expect(rows.nth(2)).toContainText("Created");
  await expect(dialog.getByRole("heading", { name: "Today" })).toBeVisible();

  await dialog.getByRole("button", { name: "Show 3 saves" }).click();
  await expect(rows).toHaveCount(5);
});

test("shows what restoring a version would change", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await noteWithHistory(page);

  const dialog = await openHistory(page);
  const rows = dialog.getByTestId("version-row");
  const detail = dialog.getByTestId("version-detail");
  const summary = detail.getByTestId("diff-summary");

  async function select(index: number): Promise<void> {
    if (mobile && (await detail.isVisible())) {
      await dialog.getByRole("button", { name: "All versions" }).click();
      await expect(detail).toBeHidden();
    }
    await rows.nth(index).click();
    await expect(detail).toBeVisible();
    await expect(rows.nth(index)).toHaveAttribute("aria-current", "true");
  }

  if (mobile) {
    await expect(detail).toBeHidden();
  } else {
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(detail.getByTestId("diff-title")).toHaveText(
      "Title: “Hello” → “Welcome”",
    );
  }

  await dialog.getByRole("button", { name: "Show 3 saves" }).click();
  await select(3);
  if (mobile) await expect(rows.nth(3)).toBeHidden();
  await expect(summary).toHaveText("Restoring would change: +1 −1 lines");
  const line = (kind: string) =>
    detail.locator(`[data-testid='diff-line'][data-kind='${kind}']`);
  await expect(line("removed")).toHaveText(/one two three$/);
  await expect(line("added")).toHaveText(/one$/);
  await expect(line("removed").locator("mark")).toHaveText(" two three");
  await expect(detail.getByTestId("diff-title")).toHaveText(
    "Title: “Hello” → “Welcome”",
  );

  if (mobile) {
    await dialog.getByRole("button", { name: "All versions" }).click();
    await expect(detail).toBeHidden();
    await expect(rows.nth(3)).toBeFocused();
  }

  await select(0);
  await expect(summary).toHaveText("Same as the current version.");

  await select(4);
  await expect(summary).toHaveText("Restoring would change: +0 −1 line");
  await expect(line("removed")).toHaveText(/one two three$/);
  await expect(detail).toContainText("Adds a line break at the end.");
});

test("the history button is hidden while naming a new note", async ({
  page,
}) => {
  await startSession(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "Note name" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Version history" }),
  ).toHaveCount(0);
});
