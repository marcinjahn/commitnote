import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, rowSyncState, SAMPLE, openNotes, fakeForge, handOverRepo } from "./helpers";
import {
  hoverDrag,
  movedToast,
  openRowMenu,
  release,
  treeItem,
  treeRows,
  type DropPoint,
} from "./helpers/tree";


const ROOT_ORDER = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

// Drags the row to the drop point on `target`, releases, and waits until
// the drop animation has settled.
async function dragRow(
  page: Page,
  source: Locator,
  target: Locator,
  point: DropPoint,
): Promise<void> {
  await hoverDrag(page, source, target, point);
  await release(page);
}

async function moveZazolcBeforeWelcome(page: Page): Promise<void> {
  const commits = await fakeForge(page).commitCount();
  await dragRow(
    page,
    treeItem(page, "Zażółć gęślą jaźń"),
    treeItem(page, "Welcome"),
    { y: 0.25 },
  );
  await expect.poll(() => fakeForge(page).commitCount()).toBe(commits + 1);
}

const REORDERED_ROOT = [
  "Empty folder",
  "Journal",
  "Projects",
  "Zażółć gęślą jaźń",
  "Welcome",
];

test("dragging a note within its folder reorders it", async ({ page }) => {
  await moveZazolcBeforeWelcome(page);

  await expect(treeRows(page)).toHaveText(REORDERED_ROOT);
  await expect(movedToast(page)).toHaveCount(0);
});

test("a reordered note shows its saving state until it is saved", async ({
  page,
}) => {
  await fakeForge(page).failNext("commit", "Network");

  await dragRow(
    page,
    treeItem(page, "Zażółć gęślą jaźń"),
    treeItem(page, "Welcome"),
    { y: 0.25 },
  );

  await expect(rowSyncState(page, "Zażółć gęślą jaźń")).toHaveCount(1);
  await expect(rowSyncState(page, "Welcome", { exact: true })).toHaveCount(0);
  await expect(rowSyncState(page, "Journal", { exact: true })).toHaveCount(0);
  await expect(rowSyncState(page, "Zażółć gęślą jaźń")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(treeRows(page)).toHaveText(REORDERED_ROOT);
});

test("another device shows the new order", async ({
  page,
  openSecondDevice,
}) => {
  await moveZazolcBeforeWelcome(page);
  const { page: other } = await openSecondDevice();
  await handOverRepo(page, other);
  await logIn(other, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(other);

  await expect(treeRows(other)).toHaveText(REORDERED_ROOT);
});

test("dropping a note onto a folder moves it into the folder", async ({
  page,
}) => {
  await dragRow(page, treeItem(page, "Welcome"), treeItem(page, "Journal"), {
    y: 0.5,
  });

  await expect(movedToast(page)).toContainText("“Welcome” moved to “Journal”");
  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "Projects",
    "Zażółć gęślą jaźń",
  ]);
  await treeItem(page, "Journal").click();
  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "2026",
    "Welcome",
    "Projects",
    "Zażółć gęślą jaźń",
  ]);
});

test("dragging a note left below its folder moves it to the top level", async ({
  page,
}) => {
  await treeItem(page, "Journal").click();
  await treeItem(page, "2026").click();
  await expect(treeItem(page, "January")).toBeVisible();

  await dragRow(page, treeItem(page, "January"), treeItem(page, "January"), {
    y: 0.9,
    x: 4,
  });

  await expect(movedToast(page)).toContainText(
    "“January” moved to the top level",
  );
  await treeItem(page, "Journal").click();
  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "January",
    "Projects",
    "Welcome",
    "Zażółć gęślą jaźń",
  ]);
});

test("Undo in the toast moves the item back to its folder and place", async ({
  page,
}) => {
  await dragRow(page, treeItem(page, "Welcome"), treeItem(page, "Journal"), {
    y: 0.5,
  });
  await expect(treeItem(page, "Welcome")).toHaveCount(0);

  await movedToast(page).getByRole("button", { name: "Undo" }).click();

  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  await expect(movedToast(page)).toHaveCount(0);
});

test("a folder can't be dropped into itself", async ({ page }) => {
  await treeItem(page, "Projects").click();
  await expect(treeItem(page, "commitnote")).toBeVisible();
  const commits = await fakeForge(page).commitCount();

  await dragRow(
    page,
    treeItem(page, "Projects"),
    treeItem(page, "commitnote"),
    {
      y: 0.5,
    },
  );

  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "Projects",
    "commitnote",
    "Welcome",
    "Zażółć gęślą jaźń",
  ]);
  await expect(movedToast(page)).toHaveCount(0);
  expect(await fakeForge(page).commitCount()).toBe(commits);
});

test("Escape cancels a lifted drag and the release does nothing", async ({
  page,
}) => {
  const commits = await fakeForge(page).commitCount();

  await hoverDrag(
    page,
    treeItem(page, "Zażółć gęślą jaźń"),
    treeItem(page, "Welcome"),
    { y: 0.25 },
  );
  const focusBefore = await page.evaluate(
    () => document.activeElement?.outerHTML ?? null,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);

  await page.mouse.up();

  await expect(page.getByRole("textbox", { name: "Note editor" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  expect(
    await page.evaluate(() => document.activeElement?.outerHTML ?? null),
  ).toBe(focusBefore);
  expect(await fakeForge(page).commitCount()).toBe(commits);
});

test("a click still opens a note and a drag doesn't", async ({ page }) => {
  await dragRow(page, treeItem(page, "Welcome"), treeItem(page, "Welcome"), {
    y: 0.5,
  });
  await expect(page.getByRole("textbox", { name: "Note editor" })).toHaveCount(
    0,
  );

  await treeItem(page, "Welcome").click();

  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
  await expect(treeItem(page, "Welcome")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

function noteEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Note editor" });
}

function noteDropHighlight(page: Page): Locator {
  return page.locator("[data-note-drop]");
}

test("dropping a note on the open note opens it without reordering", async ({
  page,
}) => {
  await treeItem(page, "Welcome").click();
  await expect(noteEditor(page)).toBeVisible();
  const commits = await fakeForge(page).commitCount();

  await hoverDrag(
    page,
    treeItem(page, "Zażółć gęślą jaźń"),
    noteEditor(page),
    { y: 0.5 },
  );
  await expect(noteDropHighlight(page)).toHaveCount(1);
  await release(page);

  await expect(treeItem(page, "Zażółć gęślą jaźń")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(treeItem(page, "Welcome")).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await expect(noteEditor(page)).toBeVisible();
  await expect(noteDropHighlight(page)).toHaveCount(0);
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  expect(await fakeForge(page).commitCount()).toBe(commits);
});

test("dropping a note on the empty note area opens it", async ({ page }) => {
  await dragRow(
    page,
    treeItem(page, "Welcome"),
    page.getByText("Select a note to read it"),
    { y: 0.5 },
  );

  await expect(noteEditor(page)).toBeVisible();
  await expect(treeItem(page, "Welcome")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
});

test("dropping a folder on the note area does nothing", async ({ page }) => {
  const commits = await fakeForge(page).commitCount();

  await hoverDrag(
    page,
    treeItem(page, "Journal"),
    page.getByText("Select a note to read it"),
    { y: 0.5 },
  );
  await expect(noteDropHighlight(page)).toHaveCount(0);
  await release(page);

  await expect(noteEditor(page)).toHaveCount(0);
  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  await expect(movedToast(page)).toHaveCount(0);
  expect(await fakeForge(page).commitCount()).toBe(commits);
});

test("Move down in the row menu reorders the row, keeps focus on it and can be undone", async ({
  page,
}) => {
  await openRowMenu(page, "Journal");
  await page.getByRole("menuitem", { name: "Move down" }).click();

  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Projects",
    "Journal",
    "Welcome",
    "Zażółć gęślą jaźń",
  ]);
  await expect(treeItem(page, "Journal")).toBeFocused();
  await expect(treeItem(page, "Journal")).toHaveAttribute("aria-posinset", "3");
  const toast = page.getByRole("group").filter({ hasText: "“Journal” moved down" });
  await expect(toast).toBeVisible();

  await toast.getByRole("button", { name: "Undo" }).click();

  await expect(treeRows(page)).toHaveText(ROOT_ORDER);
  await expect(toast).toHaveCount(0);
});

test("Move up in the row menu moves the row before its previous sibling", async ({
  page,
}) => {
  await openRowMenu(page, "Welcome");
  await page.getByRole("menuitem", { name: "Move up" }).click();

  await expect(treeRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "Welcome",
    "Projects",
    "Zażółć gęślą jaźń",
  ]);
  await expect(treeItem(page, "Welcome")).toBeFocused();
  await expect(
    page.getByRole("group").filter({ hasText: "“Welcome” moved up" }),
  ).toBeVisible();
});

test("Move up is disabled on the first sibling and Move down on the last", async ({
  page,
}) => {
  await openRowMenu(page, "Empty folder");
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeEnabled();
  await page.keyboard.press("Escape");

  await openRowMenu(page, "Zażółć gęślą jaźń");
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeEnabled();
});
