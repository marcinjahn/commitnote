import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { expectTree, openNotes, showTree, flushPendingSaves } from "./helpers";
import { headerSyncIcon, openWelcome } from "./helpers/tree";


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

test("toggling a task checkbox autosaves without focusing the editor", { tag: "@mobile" }, async ({
  page,
}, testInfo) => {
  await openNotes(page);
  await openWelcome(page);

  const syncIcon = headerSyncIcon(page);
  const openTask = page
    .locator(".cm-line", { hasText: "Open task" })
    .getByRole("checkbox", { name: "Toggle task" });

  await expect(openTask).not.toBeChecked();
  await expect(page.locator(".note-details")).toContainText("1/2 done");
  await press(openTask, testInfo);

  await expect(openTask).toBeChecked();
  await expect(page.locator(".note-details")).toContainText("2/2 done");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".cm-content")),
  ).toBe(false);
  await expect(syncIcon).toBeVisible();
  await flushPendingSaves(page);
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });

  // The fake forge lives in page memory, so a reload would reseed it; refresh
  // and reopen instead to prove the toggle reached the forge.
  await showTree(page);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expectTree(page);
  await openWelcome(page);

  const reopenedTask = page
    .locator(".cm-line", { hasText: "Open task" })
    .getByRole("checkbox", { name: "Toggle task" });
  await expect(reopenedTask).toBeChecked();
  await press(reopenedTask, testInfo);
  await expect(reopenedTask).not.toBeChecked();
  await flushPendingSaves(page);
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });
});
