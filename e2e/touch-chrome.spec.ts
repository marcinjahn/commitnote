import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome } from "./helpers/tree";

const MOBILE = { tag: "@mobile-only" } as const;

test("buttons opt out of double-tap zoom and selection", MOBILE, async ({
  page,
}) => {
  await openNotes(page);
  const styles = await page
    .getByRole("button", { name: "Refresh" })
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { touchAction: style.touchAction, userSelect: style.userSelect };
    });
  expect(styles).toEqual({ touchAction: "manipulation", userSelect: "none" });
});

test("the note name field stays editable under the header", MOBILE, async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  const field = page.locator(".note-header .name-input");
  await expect
    .poll(() => field.evaluate((el) => getComputedStyle(el).userSelect))
    .not.toBe("none");
  await field.fill("Typed title");
  await expect(field).toHaveValue("Typed title");
});

test("the page opts out of double-tap zoom at the root", MOBILE, async ({
  page,
}) => {
  await openNotes(page);
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).touchAction),
    )
    .toBe("manipulation");
});

const TEXT_ENTRY =
  'input[type="text"], input[type="password"], input[type="search"], input[type="url"], input:not([type]), textarea, .cm-content';

async function expectTextEntryNoSmallerThan16px(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator(TEXT_ENTRY).evaluateAll((elements) => {
        const visible = elements.filter((el) => el.getClientRects().length > 0);
        return {
          count: visible.length,
          small: visible
            .map((el) => parseFloat(getComputedStyle(el).fontSize))
            .filter((size) => size < 16),
        };
      }),
    )
    .toMatchObject({ small: [] });
  expect(await page.locator(TEXT_ENTRY).count()).toBeGreaterThan(0);
}

test("text entry fields never trigger focus zoom", MOBILE, async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expectTextEntryNoSmallerThan16px(page);

  await openNotes(page);
  await openWelcome(page);
  await expect(page.locator(".note-header .name-input")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expectTextEntryNoSmallerThan16px(page);

  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByLabel("Folder name")).toBeVisible();
  await expectTextEntryNoSmallerThan16px(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Search notes" }).click();
  await expect(
    page.getByRole("combobox", { name: "Search notes" }),
  ).toBeVisible();
  await expectTextEntryNoSmallerThan16px(page);
});
