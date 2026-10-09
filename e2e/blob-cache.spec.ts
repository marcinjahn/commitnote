import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { blobCacheEntryCount, expectTree, fakeForge, openNotes } from "./helpers";

const SEARCH_REPO = "https://github.com/sample/search";
const SAMPLE_TRASH_NOW = new Date("2026-09-30T12:00:00Z");

async function searchLighthouse(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Search notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Search notes" });
  await dialog
    .getByRole("combobox", { name: "Search notes" })
    .fill("lighthouse");
  const results: Locator = dialog.getByRole("listbox", {
    name: "Search results",
  });
  await expect(
    results.getByRole("group", { name: "Contents", exact: true }),
  ).toBeVisible();
  await expect(
    results
      .getByRole("group", { name: "Contents", exact: true })
      .getByRole("option"),
  ).toHaveCount(5);
  await expect(
    results.getByRole("group", { name: "Contents (partial)" }),
  ).toHaveCount(0);
  await expect(dialog.locator(".search-status-text")).toHaveCount(0);
}

test("a reloaded remembered session reaches a complete content index without reading blobs", async ({
  page,
}) => {
  await page.clock.setFixedTime(SAMPLE_TRASH_NOW);
  await openNotes(page, { repo: SEARCH_REPO });
  const forge = fakeForge(page, "sample/search");

  await searchLighthouse(page);
  const reads = await forge.blobReads();
  expect(new Set(reads).size).toBeGreaterThanOrEqual(13);
  await expect
    .poll(() => blobCacheEntryCount(page))
    .toBe(new Set(reads).size);

  await page.reload();
  await expectTree(page);

  await searchLighthouse(page);
  expect(await fakeForge(page, "sample/search").blobReads()).toEqual([]);
});
