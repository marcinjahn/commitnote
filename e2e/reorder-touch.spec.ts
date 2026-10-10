import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { TouchFinger, type TouchPoint, openNotes, fakeForge } from "./helpers";
import { treeItem, treeRows } from "./helpers/tree";


const ROOT_ORDER = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

const REORDERED_ROOT = [
  "Empty folder",
  "Journal",
  "Projects",
  "Zażółć gęślą jaźń",
  "Welcome",
];

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

function editor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Note editor" });
}

async function pointIn(
  row: Locator,
  at: { readonly x?: number; readonly y: number },
): Promise<TouchPoint> {
  const box = (await row.boundingBox())!;
  return { x: box.x + (at.x ?? 40), y: box.y + box.height * at.y };
}

// Long-presses `source` until it lifts, drags it to the point on `target`
// (a fraction of its height, x from its left edge), and waits for the drop
// to settle.
async function longPressDrag(
  page: Page,
  source: Locator,
  target: Locator,
  at: { readonly x?: number; readonly y: number },
): Promise<void> {
  const finger = await TouchFinger.on(page);
  await finger.down(await pointIn(source, { y: 0.5 }));
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await finger.move(await pointIn(target, at));
  await finger.up();
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
}

async function moveZazolcBeforeWelcome(page: Page): Promise<void> {
  const commits = await fakeForge(page).commitCount();
  await longPressDrag(
    page,
    treeItem(page, "Zażółć gęślą jaźń"),
    treeItem(page, "Welcome"),
    { y: 0.25 },
  );
  await expect.poll(() => fakeForge(page).commitCount()).toBe(commits + 1);
}

test("long-pressing a row and dragging it reorders it", { tag: "@mobile-only" }, async ({ page }) => {
  await moveZazolcBeforeWelcome(page);

  await expect(treeRows(page)).toHaveText(REORDERED_ROOT);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a long-press released without moving opens the row menu", { tag: "@mobile-only" }, async ({
  page,
}) => {
  const finger = await TouchFinger.on(page);
  await finger.down(await pointIn(treeItem(page, "Welcome"), { y: 0.5 }));
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await finger.up();

  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(
    page.getByRole("menu", { name: "Actions for Welcome" }),
  ).toBeVisible();
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
});

test("Escape cancels a long-press drag without opening the menu", { tag: "@mobile-only" }, async ({
  page,
}) => {
  const commits = await fakeForge(page).commitCount();
  const finger = await TouchFinger.on(page);
  await finger.down(
    await pointIn(treeItem(page, "Zażółć gęślą jaźń"), { y: 0.5 }),
  );
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await finger.move(await pointIn(treeItem(page, "Welcome"), { y: 0.25 }));

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  await finger.up();

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  expect(await fakeForge(page).commitCount()).toBe(commits);
});

test("a swipe scrolls the tree instead of dragging", { tag: "@mobile-only" }, async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 320 });
  await treeItem(page, "Journal").tap();
  await treeItem(page, "2026").tap();
  await treeItem(page, "Projects").tap();
  const container = page.getByRole("tree", { name: "Notes" }).locator("..");
  await expect
    .poll(() =>
      container.evaluate((el) => el.scrollHeight - el.clientHeight),
    )
    .toBeGreaterThan(40);
  const rowsBefore = await treeRows(page).allTextContents();

  const start = await pointIn(treeItem(page, "commitnote"), { y: 0.5 });
  const finger = await TouchFinger.on(page);
  await page.clock.install();
  await finger.down(start);
  await finger.move({ x: start.x, y: start.y - 120 });
  await page.clock.runFor(600);
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
  await finger.up();

  await expect
    .poll(() => container.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(treeRows(page)).toHaveText(rowsBefore);
  await expect(editor(page)).toHaveCount(0);
});

test("a tap still opens the note", { tag: "@mobile-only" }, async ({ page }) => {
  await treeItem(page, "Welcome").tap();

  await expect(editor(page)).toBeVisible();
});

test("long-pressing a row and dropping it on the trash button deletes it", { tag: "@mobile-only" }, async ({ page }) => {
  const trash = page.getByTestId("open-trash");
  const finger = await TouchFinger.on(page);
  await finger.down(await pointIn(treeItem(page, "Welcome"), { y: 0.5 }));
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await expect(trash).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
  const box = (await trash.boundingBox())!;
  await finger.move({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(trash).toHaveAttribute("data-trash-drop", /.*/);
  await finger.up();
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Move to trash?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
  await expect(trash).toHaveText(/Trash \(1\)/);
});
