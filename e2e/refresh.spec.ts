import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, fakeForge } from "./helpers";
import { openWelcome, waitForSynced } from "./helpers/tree";


test("there is only one Refresh button", { tag: "@mobile" }, async ({ page }, testInfo) => {
  await openNotes(page);
  const refresh = page.getByRole("button", { name: "Refresh" });

  if (testInfo.project.name === "desktop") {
    await page.getByRole("treeitem", { name: "Welcome" }).click();
    await expect(
      page.getByRole("textbox", { name: "Note editor" }),
    ).toBeVisible();
  }
  await expect(refresh).toHaveCount(1);
});

const REFRESH_FAILED = "Could not reach GitHub. Showing the last loaded notes.";

async function setVisibility(
  page: Page,
  state: "visible" | "hidden",
): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", {
      value,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("returning to the tab refreshes", async ({ page }) => {
  await page.clock.install();
  await openNotes(page);
  await page.clock.runFor(16_000);

  await fakeForge(page).editNote(["Remote note"], "# Remote note");
  await setVisibility(page, "visible");

  await expect(page.getByRole("treeitem", { name: "Remote note" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).not.toHaveAttribute(
    "data-feedback",
  );
  await expect(page.getByRole("status").filter({ hasText: "Refreshed" })).toHaveCount(0);
});

test("a hidden tab does not refresh", async ({ page }) => {
  await page.clock.install();
  await openNotes(page);
  const forge = fakeForge(page);
  const remoteNote = page.getByRole("treeitem", { name: "Remote note" });

  await setVisibility(page, "hidden");
  await forge.editNote(["Remote note"], "# Remote note");
  const headsBefore = await forge.getHeadCount();
  await page.clock.runFor(180_000);

  expect(await forge.getHeadCount()).toBe(headsBefore);
  await expect(remoteNote).toHaveCount(0);

  await setVisibility(page, "visible");
  await expect(remoteNote).toBeVisible();
});

test("refreshes every minute while visible", { tag: "@mobile" }, async ({ page }) => {
  await page.clock.install();
  await openNotes(page);

  await fakeForge(page).editNote(["Remote note"], "# Remote note");
  await page.clock.runFor(60_000);

  await expect(page.getByRole("treeitem", { name: "Remote note" })).toBeVisible();
});

test("a background refresh with an unchanged head reads the head once and lists no tree", async ({
  page,
}) => {
  await page.clock.install();
  await openNotes(page);
  const forge = fakeForge(page);
  const headsBefore = await forge.getHeadCount();
  const treesBefore = await forge.listTreeCount();

  await page.clock.runFor(60_000);

  await expect.poll(() => forge.getHeadCount()).toBe(headsBefore + 1);
  expect(await forge.listTreeCount()).toBe(treesBefore);
});

test("no automatic refresh while there are unsaved edits", async ({ page }) => {
  await page.clock.install();
  await openNotes(page);
  await page.clock.runFor(16_000);
  await openWelcome(page);
  const forge = fakeForge(page);
  const note = page.getByRole("textbox", { name: "Note editor" });
  const remoteNote = page.getByRole("treeitem", { name: "Remote note" });

  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
  await note.click();
  await page.keyboard.type(" typed here");
  await forge.editNote(["Remote note"], "# Remote note");
  const headsBefore = await forge.getHeadCount();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(1_000);

  expect(await forge.getHeadCount()).toBe(headsBefore);
  await expect(remoteNote).toHaveCount(0);
  await expect(note).toContainText("typed here");

  await page.clock.resume();
  await waitForSynced(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(remoteNote).toBeVisible();
  await expect(note).toContainText("typed here");
});

test("a background failure toasts once and clears after recovery", async ({
  page,
}) => {
  await page.clock.install();
  await openNotes(page);
  const forge = fakeForge(page);
  const toast = page.getByRole("group").filter({ hasText: REFRESH_FAILED });
  const headsBefore = await forge.getHeadCount();

  await forge.failNext("getHead", "Network");
  await page.clock.runFor(60_000);
  await expect.poll(() => forge.getHeadCount()).toBe(headsBefore + 1);
  await expect(toast).toHaveCount(0);

  await forge.failNext("getHead", "Network");
  await page.clock.runFor(120_000);
  await expect(toast).toBeVisible();

  await forge.failNext("getHead", "Network");
  await page.clock.runFor(240_000);
  await expect.poll(() => forge.getHeadCount()).toBe(headsBefore + 3);
  await expect(toast).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.clock.runFor(480_000);
  await expect(toast).toHaveCount(0);
});

test("a background refresh clears the toast of a failed Refresh", async ({
  page,
}) => {
  await page.clock.install();
  await openNotes(page);
  const forge = fakeForge(page);
  const toast = page.getByRole("group").filter({ hasText: REFRESH_FAILED });

  await forge.failNext("getHead", "Network");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(toast).toBeVisible();

  const headsBefore = await forge.getHeadCount();
  await page.clock.runFor(60_000);
  await expect.poll(() => forge.getHeadCount()).toBeGreaterThan(headsBefore);
  await expect(toast).toHaveCount(0);
});

test("clicking Refresh with an unchanged head reads the head once and lists no tree", async ({
  page,
}) => {
  await openNotes(page);
  const forge = fakeForge(page);
  const headsBefore = await forge.getHeadCount();
  const treesBefore = await forge.listTreeCount();

  const refresh = page.getByRole("button", { name: "Refresh" });
  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");

  expect(await forge.getHeadCount()).toBe(headsBefore + 1);
  expect(await forge.listTreeCount()).toBe(treesBefore);
});

test("clicking Refresh briefly shows a checkmark", async ({ page }) => {
  await openNotes(page);
  const refresh = page.getByRole("button", { name: "Refresh" });

  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");
  await expect(page.getByRole("status").filter({ hasText: "Refreshed" })).toHaveCount(1);
  await expect(refresh).not.toHaveAttribute("data-feedback");
});

test("a failed Refresh shows the error in a toast and an x", async ({
  page,
}) => {
  await openNotes(page);
  const refresh = page.getByRole("button", { name: "Refresh" });

  await fakeForge(page).failNext("getHead", "Network");
  await refresh.click();

  await expect(refresh).toHaveAttribute("data-feedback", "error");
  const toast = page.getByRole("group").filter({
    hasText: REFRESH_FAILED,
  });
  await expect(toast).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(refresh).not.toHaveAttribute("data-feedback");

  await refresh.click();
  await expect(refresh).toHaveAttribute("data-feedback", "success");
  await expect(toast).toHaveCount(0);
});

test.describe("with forge latency", () => {
  test.use({ forgeLatency: "github" });

  test("a background refresh leaves the Refresh button idle", async ({ page }) => {
    await page.clock.install();
    await openNotes(page);
    const refresh = page.getByRole("button", { name: "Refresh" });
    const forge = fakeForge(page);

    await forge.editNote(["Remote note"], "# Remote note");
    const headsBefore = await forge.getHeadCount();
    await page.clock.pauseAt(new Date(Date.now() + 10_000));
    await page.clock.runFor(16_000);
    await setVisibility(page, "visible");
    await page.clock.runFor(200);
    await expect.poll(() => forge.getHeadCount()).toBeGreaterThan(headsBefore);

    await expect(page.getByRole("treeitem", { name: "Remote note" })).toHaveCount(0);
    await expect(refresh).toBeEnabled();
    await expect(refresh).not.toHaveAttribute("aria-busy", "true");
    await expect(refresh.locator(".spinning")).toHaveCount(0);

    await page.clock.resume();
    await refresh.click();
    await expect(refresh).toHaveAttribute("data-feedback", "success");
    await expect(page.getByRole("treeitem", { name: "Remote note" })).toBeVisible();
  });
});
