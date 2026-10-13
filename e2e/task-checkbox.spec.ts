import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { expectTree, openNotes, showTree, flushPendingSaves } from "./helpers";
import { createLink } from "./helpers/sharing";
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
    .getByRole("checkbox", { name: "Task: Open task" });

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
    .getByRole("checkbox", { name: "Task: Open task" });
  await expect(reopenedTask).toBeChecked();
  await press(reopenedTask, testInfo);
  await expect(reopenedTask).not.toBeChecked();
  await flushPendingSaves(page);
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });
});

test("Space toggles a focused task checkbox and keeps focus", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);

  const openTask = page
    .locator(".cm-line", { hasText: "Open task" })
    .getByRole("checkbox", { name: "Task: Open task" });
  await expect(page.locator(".note-details")).toContainText("1/2 done");

  await openTask.focus();
  await page.keyboard.press("Space");

  await expect(page.locator(".note-details")).toContainText("2/2 done");
  await expect(openTask).toBeFocused();
  await expect(openTask).toBeChecked();
});

test("the task checkbox has a 24px hit area", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);

  const wrapper = page
    .locator(".cm-line", { hasText: "Open task" })
    .locator(".cm-task-checkbox");
  const box = await wrapper.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(24);
  expect(box?.height).toBeGreaterThanOrEqual(24);
});

test("the task checkbox is disabled in the shared viewer", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await createLink(page);

  const viewer = await page.context().newPage();
  await viewer.goto(link);

  await expect(
    viewer
      .locator(".cm-line", { hasText: "Open task" })
      .getByRole("checkbox", { name: "Task: Open task" }),
  ).toBeDisabled();
});
