import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";

const KEY = "commitnote.sidebarWidth";

function handle(page: Page) {
  return page.getByRole("separator", { name: "Resize sidebar" });
}

async function sidebarWidth(page: Page): Promise<number> {
  const box = await page.locator("aside.sidebar").boundingBox();
  if (box === null) throw new Error("sidebar not rendered");
  return box.width;
}

async function expectSidebarWidth(page: Page, width: number): Promise<void> {
  await expect.poll(() => sidebarWidth(page)).toBeCloseTo(width, 0);
}

async function storedWidth(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), KEY);
}

async function dragBy(page: Page, dx: number): Promise<void> {
  const box = await handle(page).boundingBox();
  if (box === null) throw new Error("handle not rendered");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test.describe("on desktop", () => {
  test.skip(({ isMobile }) => isMobile, "the handle is desktop only");

  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("dragging the handle resizes the sidebar and the width survives a reload", async ({
    page,
  }) => {
    await expectSidebarWidth(page, 300);

    const box = await handle(page).boundingBox();
    if (box === null) throw new Error("handle not rendered");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y, { steps: 4 });
    expect(
      await page.evaluate(() => getComputedStyle(document.body).cursor),
    ).toBe("col-resize");
    expect(await storedWidth(page)).toBeNull();
    await page.mouse.move(x + 200, y, { steps: 4 });
    await page.mouse.up();

    await expectSidebarWidth(page, 500);
    expect(await storedWidth(page)).toBe("500");

    await openNotes(page);
    await expectSidebarWidth(page, 500);
  });

  test("double-clicking the handle restores the default width", async ({
    page,
  }) => {
    await dragBy(page, 200);
    await expectSidebarWidth(page, 500);

    await handle(page).dblclick();

    await expectSidebarWidth(page, 300);
    expect(await storedWidth(page)).toBeNull();

    await openNotes(page);
    await expectSidebarWidth(page, 300);
  });

  test("arrow, Home and End keys resize the focused handle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await handle(page).focus();

    await page.keyboard.press("ArrowRight");
    expect(
      await handle(page).evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe("none");
    await page.keyboard.press("ArrowRight");
    await expectSidebarWidth(page, 332);
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "332");

    await page.keyboard.press("ArrowLeft");
    await expectSidebarWidth(page, 316);
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "316");

    await page.keyboard.press("End");
    await expect(handle(page)).toHaveAttribute("aria-valuemax", "640");
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
    await expectSidebarWidth(page, 640);

    await page.keyboard.press("Home");
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "300");
    await expectSidebarWidth(page, 300);
    expect(await storedWidth(page)).toBe("300");
  });

  test("a narrow window shows less than the preference and widening restores it", async ({
    page,
  }) => {
    const original = page.viewportSize();
    if (original === null) throw new Error("no viewport");
    await page.setViewportSize({ width: 1280, height: 800 });
    await dragBy(page, 200);
    await expectSidebarWidth(page, 500);

    await page.setViewportSize({ width: 800, height: 800 });
    await expectSidebarWidth(page, 400);
    await expect(handle(page)).toHaveAttribute("aria-valuemax", "400");

    await page.setViewportSize(original);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectSidebarWidth(page, 500);
  });

  test("typing with the handle focused starts no note", async ({ page }) => {
    const before = await page.getByRole("treeitem").allTextContents();
    await handle(page).focus();

    await page.keyboard.type("abc");

    await expect(page.getByText("Select a note to read it, or")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveCount(
      0,
    );
    expect(await page.getByRole("treeitem").allTextContents()).toEqual(before);
  });
});

test(
  "the resize handle is not offered on the narrow layout",
  { tag: "@mobile" },
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "mobile layout only");
    await openNotes(page);

    await expect(handle(page)).toBeHidden();
  },
);
