import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { expectTree, logIn, TouchFinger, type TouchPoint, SAMPLE, openNotes, fakeForge } from "./helpers";


const REORDERED_ROOT = [
  "Empty folder",
  "Journal",
  "Projects",
  "Zażółć gęślą jaźń",
  "Welcome",
];

const RELOAD_TEST = "the order set by touch survives a reload";

test.beforeEach(async ({ page }, testInfo) => {
  // That test expects the login screen after its reload.
  await openNotes(
    page,
    testInfo.title === RELOAD_TEST ? { via: "login" } : {},
  );
});

function treeItem(page: Page, name: string): Locator {
  return page.getByRole("treeitem", { name, exact: true });
}

function treeRows(page: Page): Locator {
  return page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
}

function editor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Note editor" });
}

function movedToast(page: Page): Locator {
  return page.getByRole("group").filter({ hasText: "moved to" });
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

test("dragging a note onto a folder moves it in", { tag: "@mobile-only" }, async ({ page }) => {
  await longPressDrag(
    page,
    treeItem(page, "Welcome"),
    treeItem(page, "Journal"),
    { y: 0.5 },
  );

  await expect(movedToast(page)).toContainText("“Welcome” moved to “Journal”");
  await treeItem(page, "Journal").tap();
  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "2026",
    "Welcome",
    "Projects",
    "Zażółć gęślą jaźń",
  ]);
});

test("dragging a note left below its folder moves it out", { tag: "@mobile-only" }, async ({
  page,
}) => {
  await treeItem(page, "Journal").tap();
  await treeItem(page, "2026").tap();
  await expect(treeItem(page, "January")).toBeVisible();

  await longPressDrag(
    page,
    treeItem(page, "January"),
    treeItem(page, "January"),
    { y: 0.9, x: 4 },
  );

  await expect(movedToast(page)).toContainText(
    "“January” moved to the top level",
  );
  await expect(editor(page)).toHaveCount(0);
  await treeItem(page, "Journal").tap();
  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "January",
    "Projects",
    "Welcome",
    "Zażółć gęślą jaźń",
  ]);
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
  await finger.down(start);
  await finger.move({ x: start.x, y: start.y - 120 });
  await finger.hold(600);
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

test(RELOAD_TEST, { tag: "@mobile-only" }, async ({ page }) => {
  await moveZazolcBeforeWelcome(page);
  const exported = await fakeForge(page).exportRepo();

  await page.reload();
  await fakeForge(page).adoptRepo(exported);
  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);

  await expect(treeRows(page)).toHaveText(REORDERED_ROOT);
});
