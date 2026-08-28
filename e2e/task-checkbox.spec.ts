import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

async function openWelcome(page: Page): Promise<void> {
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
}

async function press(
  locator: ReturnType<Page["locator"]>,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.project.name === "mobile") {
    await locator.tap();
  } else {
    await locator.click();
  }
}

test("toggling a task checkbox autosaves without focusing the editor", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
  await openWelcome(page);

  const syncIcon = page.locator("header.note-header").getByRole("img");
  const openTask = page
    .locator(".cm-line", { hasText: "Open task" })
    .getByRole("checkbox", { name: "Toggle task" });

  await expect(openTask).not.toBeChecked();
  await press(openTask, testInfo);

  await expect(openTask).toBeChecked();
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".cm-content")),
  ).toBe(false);
  await expect(syncIcon).toBeVisible();
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });

  // The fake forge lives in page memory, so a reload would reseed it; refresh
  // and reopen instead to prove the toggle reached the forge.
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to notes" }).click();
  }
  await page.getByRole("button", { name: "Refresh" }).click();
  await expectTree(page);
  await openWelcome(page);

  const reopenedTask = page
    .locator(".cm-line", { hasText: "Open task" })
    .getByRole("checkbox", { name: "Toggle task" });
  await expect(reopenedTask).toBeChecked();
  await press(reopenedTask, testInfo);
  await expect(reopenedTask).not.toBeChecked();
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });
});
