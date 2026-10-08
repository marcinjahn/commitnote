import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree } from "./helpers";
import { moveToTrash, openWelcome } from "./helpers/tree";
import { openSettings } from "./helpers/settings";

test.skip(({ isMobile }) => isMobile, "viewport is set per test");

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function expectNoOverflow(page: Page): Promise<void> {
  await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(0);
}

test.describe("reflow", () => {
  test("at 320x256 the sidebar scrolls to the trash row and log out", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await openNotes(page);
    await moveToTrash(page, "Welcome");
    await showTree(page);

    const tree = page.getByRole("tree", { name: "Notes" });
    const container = await tree.evaluate(
      (el) => el.parentElement!.getBoundingClientRect().height,
    );
    expect(container).toBeGreaterThanOrEqual(120);

    const nav = page.getByRole("navigation", { name: "Notes" });
    await nav.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    const viewportHeight = page.viewportSize()!.height;
    for (const target of [
      page.getByTestId("open-trash"),
      page.getByRole("button", { name: "Log out", exact: true }),
    ]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
    }
    await expectNoOverflow(page);
  });

  test("at 640x400 nothing overflows horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await openNotes(page);
    await expectNoOverflow(page);

    await openWelcome(page);
    await expectNoOverflow(page);

    await showTree(page);
    await expectNoOverflow(page);

    await openSettings(page);
    await expectNoOverflow(page);
  });

  test("at 320x640 the tree and note views do not overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openNotes(page);
    await expectNoOverflow(page);

    await openWelcome(page);
    await expectNoOverflow(page);
  });

  test("at 1280x800 the sidebar does not scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    const nav = page.getByRole("navigation", { name: "Notes" });
    const [scrollHeight, clientHeight] = await nav.evaluate((el) => [
      el.scrollHeight,
      el.clientHeight,
    ]);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  });
});
