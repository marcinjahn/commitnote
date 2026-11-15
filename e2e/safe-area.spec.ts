import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

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
  await page.goto("./");
  const content = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(content).toContain("viewport-fit=cover");
  expect(content).toContain("interactive-widget=resizes-content");
  expect(content).toContain("user-scalable=no");
  expect(content).toContain("maximum-scale=1");
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

// iOS WebKit (LocalFrameView::fixedContainerEdges) lays a soft blur over the top
// screen edge unless the hit at its midpoint has a sticky or fixed, opaque,
// near full-width ancestor. Returns the classes of that ancestor, if any.
function topEdgeBar(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    let element = document.elementFromPoint(innerWidth / 2, 4);
    while (element !== null) {
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.position === "sticky") {
        // Opaque sRGB colors compute to rgb(); translucent ones to rgba().
        const opaque = style.backgroundColor.startsWith("rgb(");
        const wide = element.getBoundingClientRect().width >= innerWidth * 0.9;
        return opaque && wide ? element.className : null;
      }
      element = element.parentElement;
    }
    return null;
  });
}

const hideTestBanner = { content: ".test-mode-banner { display: none; }" };

test("an opaque sticky bar marks the top edge", MOBILE, async ({ page }) => {
  await overrideInsets(page, { top: 48, bottom: 34, left: 0, right: 0 });
  await openNotes(page);
  await page.addStyleTag(hideTestBanner);
  await expect.poll(() => topEdgeBar(page)).toContain("tree-header");
  await openWelcome(page);
  await expect.poll(() => topEdgeBar(page)).toContain("note-header");
});

test("on a short screen the tree header scrolls away", MOBILE, async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await openNotes(page);
  await page.addStyleTag(hideTestBanner);
  await treeItem(page, "Journal").click();
  await treeItem(page, "Projects").click();

  const sidebar = page.getByRole("navigation", { name: "Notes" });
  await expect
    .poll(() => sidebar.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await sidebar.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () => {
      const box = (await page.locator(".tree-header").boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(0);
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
  await page.goto("./");
  const card = page.locator(".login-shell > *").first();
  await expect
    .poll(async () => (await card.boundingBox())?.y)
    .toBeGreaterThanOrEqual(48);
});

test(
  "the floating New note button clears the bottom inset and the last row",
  MOBILE,
  async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 560 });
    await overrideInsets(page, { top: 0, bottom: 34, left: 0, right: 0 });
    await openNotes(page);
    await treeItem(page, "Journal").click();
    await treeItem(page, "Projects").click();

    const container = page.locator(".tree-container");
    await expect
      .poll(() =>
        container.evaluate((el) => el.scrollHeight > el.clientHeight),
      )
      .toBe(true);

    const button = page.getByRole("button", { name: "New note", exact: true });
    const viewportHeight = page.viewportSize()!.height;
    await expect
      .poll(async () => {
        const box = (await button.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(viewportHeight - 34);

    await container.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(async () => {
        const last = (await treeItem(page, /./).last().boundingBox())!;
        const top = (await button.boundingBox())!.y;
        return last.y + last.height <= top;
      })
      .toBe(true);
  },
);
