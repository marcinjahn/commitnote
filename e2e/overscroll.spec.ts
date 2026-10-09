import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome } from "./helpers/tree";

const MOBILE = { tag: "@mobile" } as const;

function overscrollY(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).overscrollBehaviorY);
}

test("page scroll does not chain or bounce", MOBILE, async ({ page }) => {
  await openNotes(page);
  expect(await overscrollY(page, "html")).toBe("none");
  expect(await overscrollY(page, "body")).toBe("none");
});

test("inner scrollers contain overscroll", MOBILE, async ({ page }) => {
  await openNotes(page);
  expect(await overscrollY(page, ".tree-container")).toBe("contain");
  await openWelcome(page);
  expect(await overscrollY(page, ".cm-scroller")).toBe("contain");
});
