import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome, rowActionsButton } from "./helpers/tree";

const KEY = "commitnote.sidebarWidth";

function handle(page: Page) {
  return page.getByRole("separator", { name: "Resize sidebar" });
}

async function sidebarWidth(page: Page): Promise<number> {
  const box = await page.getByRole("navigation", { name: "Notes" }).boundingBox();
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

  test("Enter on the focused handle restores the default width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await handle(page).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expectSidebarWidth(page, 332);

    await page.keyboard.press("Enter");

    await expectSidebarWidth(page, 300);
    await expect(handle(page)).toHaveAttribute("aria-valuenow", "300");
    await expect(handle(page)).toBeFocused();
    expect(await storedWidth(page)).toBeNull();
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

  test("the handle has a 24px hit area reaching 16px into the note pane", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWelcome(page);
    const nav = await page
      .getByRole("navigation", { name: "Notes" })
      .boundingBox();
    const box = await handle(page).boundingBox();
    const input = await page
      .getByRole("textbox", { name: "Note name" })
      .boundingBox();
    if (nav === null || box === null || input === null) {
      throw new Error("not rendered");
    }
    const navRight = nav.x + nav.width;
    const midY = box.y + box.height / 2;
    expect(box.width).toBeCloseTo(24, 0);
    expect(Math.abs(box.x + box.width - (navRight + 16))).toBeLessThanOrEqual(
      1,
    );
    expect(box.x + box.width).toBeLessThanOrEqual(input.x);

    const hitRole = (x: number) =>
      page.evaluate(
        ([px, py]) =>
          document.elementFromPoint(px, py)?.getAttribute("role") ?? null,
        [x, midY],
      );
    for (const x of [navRight + 12, navRight - 4]) {
      expect(await hitRole(x)).toBe("separator");
    }

    await page.mouse.move(navRight + 12, midY);
    await page.mouse.down();
    await page.mouse.move(navRight + 62, midY, { steps: 4 });
    await page.mouse.move(navRight + 112, midY, { steps: 4 });
    await page.mouse.up();
    await expectSidebarWidth(page, 400);

    const newRight = navRight + 100;
    for (const x of [newRight + 12, newRight - 4]) {
      expect(await hitRole(x)).toBe("separator");
    }
  });

  test("the handle does not cover the tree scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const points = await page.getByRole("tree").evaluate((tree) => {
      const container = tree.parentElement;
      if (container === null) throw new Error("no tree container");
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      container.appendChild(spacer);
      const width = container.offsetWidth - container.clientWidth;
      const rect = container.getBoundingClientRect();
      const nav = tree.closest("nav");
      if (nav === null) throw new Error("no nav");
      const y = rect.top + rect.height / 2;
      const xs =
        width > 0
          ? [
              Math.ceil(rect.right - width) + 1,
              Math.floor(rect.right - width / 2) - 1,
            ]
          : [nav.getBoundingClientRect().right - 9];
      return xs.map((x) => ({ x, y }));
    });
    const hits = await page.evaluate(
      (pts) =>
        pts.map(
          ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("role") ?? null,
        ),
      points,
    );
    for (const hit of hits) {
      expect(hit).not.toBe("separator");
    }
  });

  test("the visible line stays 2px wide at the sidebar edge", async ({
    page,
  }) => {
    const line = await handle(page).evaluate((el) => {
      const style = getComputedStyle(el, "::after");
      return { right: style.right, width: style.width };
    });
    expect(line).toEqual({ right: "17px", width: "2px" });
  });

  test("the handle does not cover the row actions button", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWelcome(page);
    await page.getByRole("treeitem", { name: "Welcome", exact: true }).hover();
    const button = rowActionsButton(page, "Welcome");
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (box === null) throw new Error("button not rendered");
    const isButton = await button.evaluate(
      (el, [x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && el.contains(hit);
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(isButton).toBe(true);
  });

  test("the focused handle line is visible in forced colours", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.keyboard.press("Tab");
    await handle(page).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(handle(page)).toBeFocused();
    await expect
      .poll(() =>
        handle(page).evaluate(
          (el) => getComputedStyle(el, "::after").backgroundColor,
        ),
      )
      .not.toBe("rgba(0, 0, 0, 0)");
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
