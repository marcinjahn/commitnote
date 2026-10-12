import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { TouchFinger, openNotes, showTree } from "./helpers";
import { chooseOption, closeSettings, openSettings } from "./helpers/settings";
import { openWelcome, treeItem } from "./helpers/tree";

const MOBILE = { tag: "@mobile-only" } as const;

function newNoteButton(page: Page) {
  return page.getByRole("button", { name: "New note", exact: true });
}

test("the extended button starts a draft and places the note at the end", MOBILE, async ({
  page,
}) => {
  await openNotes(page);
  await openSettings(page);
  await chooseOption(page, "New notes", "At the end");
  await closeSettings(page);

  const button = newNoteButton(page);
  await expect(button).toBeVisible();
  await expect(button.getByText("New note")).toBeVisible();
  await expect(
    page.locator(".tree-header").getByRole("button", { name: "New note" }),
  ).toHaveCount(0);

  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = (await button.boundingBox())!;
      return [
        Math.round(viewport.width - (box.x + box.width)),
        Math.round(viewport.height - (box.y + box.height)),
      ];
    })
    .toEqual([24, 24]);

  await button.click();
  const nameField = page.getByRole("textbox", { name: "Note name" });
  await expect(nameField).toBeFocused();
  await expect(button).toBeHidden();

  const name = `Floating ${Date.now()}`;
  await nameField.fill(name);
  await nameField.press("Enter");
  await showTree(page);

  await expect(page.locator('[role="treeitem"][aria-level="1"]').last()).toHaveText(
    name,
  );
});

test("returning from a note shows the compact button", MOBILE, async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await showTree(page);

  const button = newNoteButton(page);
  await expect(button).toBeVisible();
  await expect(button.getByText("New note")).not.toBeVisible();
  await expect
    .poll(async () => {
      const box = (await button.boundingBox())!;
      return [Math.round(box.width), Math.round(box.height)];
    })
    .toEqual([56, 56]);
});

test("a sheet hides the button", MOBILE, async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(newNoteButton(page)).toBeHidden();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(newNoteButton(page)).toBeVisible();
});

test("a tree drag hides the button", MOBILE, async ({ page }) => {
  await openNotes(page);
  const box = (await treeItem(page, "Projects").boundingBox())!;
  const finger = await TouchFinger.on(page);
  await finger.down({ x: box.x + 40, y: box.y + box.height / 2 });
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await expect(newNoteButton(page)).toBeHidden();

  await page.keyboard.press("Escape");
  await finger.up();
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
  await expect(newNoteButton(page)).toBeVisible();
});

test("the search palette hides the button", MOBILE, async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Search notes" }).click();
  await expect(page.getByRole("dialog", { name: "Search notes" })).toBeVisible();
  await expect(newNoteButton(page)).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(newNoteButton(page)).toBeVisible();
});

test.describe("on a narrow desktop window", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  async function expectDesktopPointer(page: Page): Promise<void> {
    expect(
      await page.evaluate(() => ({
        fine: matchMedia("(pointer: fine)").matches,
        touch: navigator.maxTouchPoints,
      })),
    ).toEqual({ fine: true, touch: 0 });
  }

  test("shows the button with a mouse and no touch", async ({ page }) => {
    await openNotes(page);
    await expectDesktopPointer(page);
    await expect(newNoteButton(page)).toBeVisible();
  });

  test("shows the button when the visual viewport is a few pixels short", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(VisualViewport.prototype, "height", {
        configurable: true,
        get: () => document.documentElement.clientHeight - 3,
      });
    });
    await openNotes(page);
    await expectDesktopPointer(page);
    await expect(newNoteButton(page)).toBeVisible();
  });
});
