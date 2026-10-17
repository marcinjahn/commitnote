import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome } from "./helpers/tree";

const MOBILE = { tag: "@mobile-only" } as const;

async function overrideInsets(
  page: Page,
  insets: { top: number; bottom: number; left: number; right: number },
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
}

test("the viewport covers the screen and resizes with the keyboard", MOBILE, async ({
  page,
}) => {
  await page.goto("/");
  const content = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(content).toContain("viewport-fit=cover");
  expect(content).toContain("interactive-widget=resizes-content");
});

test("the tree header stays below the top inset", MOBILE, async ({ page }) => {
  await overrideInsets(page, { top: 48, bottom: 34, left: 0, right: 0 });
  await openNotes(page);
  const header = page.locator(".tree-header");
  await expect
    .poll(async () => (await header.getByRole("button").first().boundingBox())?.y)
    .toBeGreaterThanOrEqual(48);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeInViewport({
    ratio: 1,
  });
});

test("the note header stays below the top inset", MOBILE, async ({ page }) => {
  await overrideInsets(page, { top: 48, bottom: 34, left: 0, right: 0 });
  await openNotes(page);
  await openWelcome(page);
  const back = page.getByRole("button", { name: "Back to notes" });
  await expect
    .poll(async () => (await back.boundingBox())?.y)
    .toBeGreaterThanOrEqual(48);
});

test("the tree header stays inside the side insets", MOBILE, async ({ page }) => {
  await overrideInsets(page, { top: 0, bottom: 21, left: 47, right: 47 });
  await openNotes(page);
  const header = page.locator(".tree-header");
  const width = page.viewportSize()!.width;
  await expect
    .poll(async () => (await header.boundingBox())?.x)
    .toBeGreaterThanOrEqual(47);
  await expect
    .poll(async () => {
      const box = (await header.boundingBox())!;
      return box.x + box.width;
    })
    .toBeLessThanOrEqual(width - 47);
});

test("the login screen stays below the top inset", MOBILE, async ({ page }) => {
  await overrideInsets(page, { top: 48, bottom: 0, left: 0, right: 0 });
  await page.goto("/");
  const card = page.locator(".login-shell > *").first();
  await expect
    .poll(async () => (await card.boundingBox())?.y)
    .toBeGreaterThanOrEqual(48);
});
