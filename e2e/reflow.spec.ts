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
  test("at 320x256 the Trash menu item stays in view", async ({
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

    await page.getByRole("button", { name: "More commands" }).click();
    const item = page.getByRole("menuitem", { name: "Trash (1)" });
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
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

  test.describe("text spacing", () => {
    const spacing = `
      * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-bottom: 2em !important; }
    `;

    for (const size of [
      { width: 1280, height: 800 },
      { width: 320, height: 640 },
    ]) {
      test(`${size.width}x${size.height} the name field grows with its text`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await openNotes(page);
        await openWelcome(page);
        await page.addStyleTag({ content: spacing });

        const name = page.getByRole("textbox", { name: "Note name" });
        await expect(name).toBeVisible();
        await expectNoOverflow(page);
        const [scrollHeight, clientHeight] = await name.evaluate((el) => [
          el.scrollHeight,
          el.clientHeight,
        ]);
        expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
      });
    }

    test("settings labels and font preview lines are not clipped", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openNotes(page);
      const dialog = await openSettings(page);
      await page.addStyleTag({ content: spacing });

      const clipped = await dialog.evaluate((root) => {
        const lines = root.querySelectorAll(
          ".setting-option-label, [data-testid='font-preview'] p",
        );
        return {
          count: lines.length,
          clipped: [...lines]
            .filter(
              (el) =>
                el.scrollHeight > el.clientHeight + 1 ||
                el.scrollWidth > el.clientWidth + 1,
            )
            .map((el) => el.textContent?.trim()),
        };
      });
      expect(clipped.count).toBeGreaterThan(0);
      expect(clipped.clipped).toEqual([]);
    });
  });

  test("the commit SHA reel scales with the text size", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    const reel = page.getByTestId("commit-sha").locator(".reel").first();
    await expect(reel).toBeVisible();
    const height = () => reel.evaluate((el) => el.getBoundingClientRect().height);
    const base = await height();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect.poll(height).toBeGreaterThanOrEqual(base * 2 - 1);
    expect(await height()).toBeLessThanOrEqual(base * 2 + 1);
  });
});
