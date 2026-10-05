import type { BrowserContextOptions, Locator, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { logIn, expectTree, rowSyncState } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const REPO_KEY = "sample/notes";

const ROOT_ORDER = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
});

function treeItem(page: Page, name: string): Locator {
  return page.getByRole("treeitem", { name, exact: true });
}

function treeRows(page: Page): Locator {
  return page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
}

function commitCount(page: Page): Promise<number> {
  return page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.commitMessages(repoKey).length,
    REPO_KEY,
  );
}

interface DropPoint {
  /** Fraction of the target row's height. */
  readonly y: number;
  /** Pointer x from the row's left edge; defaults to the middle. */
  readonly x?: number;
}

// Presses the row, moves past the drag threshold and on to the drop point
// on `target`, holding the drag there.
async function hoverDrag(
  page: Page,
  source: Locator,
  target: Locator,
  point: DropPoint,
): Promise<void> {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const startX = from.x + 40;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 2 });
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await page.mouse.move(
    to.x + (point.x ?? to.width / 2),
    to.y + to.height * point.y,
    { steps: 10 },
  );
}

async function release(page: Page): Promise<void> {
  await page.mouse.up();
  await expect(page.locator("[data-drag-state]")).toHaveCount(0);
}

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
  const commits = await commitCount(page);
  await dragRow(
    page,
    treeItem(page, "Zażółć gęślą jaźń"),
    treeItem(page, "Welcome"),
    { y: 0.25 },
  );
  await expect.poll(() => commitCount(page)).toBe(commits + 1);
}

const REORDERED_ROOT = [
  "Empty folder",
  "Journal",
  "Projects",
  "Zażółć gęślą jaźń",
  "Welcome",
];

function movedToast(page: Page): Locator {
  return page.getByRole("group").filter({ hasText: "moved to" });
}

test("dragging a note within its folder reorders it", async ({ page }) => {
  await moveZazolcBeforeWelcome(page);

  await expect(treeRows(page)).toHaveText(REORDERED_ROOT);
  await expect(movedToast(page)).toHaveCount(0);
});

test("a reordered note shows its saving state until it is saved", async ({
  page,
}) => {
  await page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.failNext(
        repoKey,
        "commit",
        "Network",
      ),
    REPO_KEY,
  );

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

test("the new order survives a reload", async ({ page }) => {
  await moveZazolcBeforeWelcome(page);
  const exported = await page.evaluate(
    (repoKey) => (window as any).__commitNoteFakeForge.exportRepo(repoKey),
    REPO_KEY,
  );

  await page.reload();
  await page.waitForFunction(() => (window as any).__commitNoteFakeForge);
  await page.evaluate(
    ([repoKey, state]) =>
      (window as any).__commitNoteFakeForge.adoptRepo(repoKey, state),
    [REPO_KEY, exported] as const,
  );
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await expect(treeRows(page)).toHaveText(REORDERED_ROOT);
});

test("another device shows the new order", async ({
  page,
  browser,
}, testInfo) => {
  await moveZazolcBeforeWelcome(page);
  const exported = await page.evaluate(
    (repoKey) => (window as any).__commitNoteFakeForge.exportRepo(repoKey),
    REPO_KEY,
  );

  const { baseURL, ...device } = testInfo.project.use as BrowserContextOptions;
  const otherContext = await browser.newContext(device);
  const other = await otherContext.newPage();
  await other.goto(new URL("/", baseURL ?? page.url()).toString());
  await other.waitForFunction(() => (window as any).__commitNoteFakeForge);
  await other.evaluate(
    ([repoKey, state]) =>
      (window as any).__commitNoteFakeForge.adoptRepo(repoKey, state),
    [REPO_KEY, exported] as const,
  );
  await logIn(other, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(other);

  await expect(treeRows(other)).toHaveText(REORDERED_ROOT);
  await otherContext.close();
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
  const commits = await commitCount(page);

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
  expect(await commitCount(page)).toBe(commits);
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
  const commits = await commitCount(page);

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
  expect(await commitCount(page)).toBe(commits);
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
  const commits = await commitCount(page);

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
  expect(await commitCount(page)).toBe(commits);
});
