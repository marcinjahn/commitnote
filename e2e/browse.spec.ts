import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { treeRows } from "./helpers/tree";


test("the tree lists root notes in order, folders in their stored order, and expands and collapses folders", async ({
  page,
}) => {
  await openNotes(page);

  await test.step("root notes list in order", async () => {
    await expect(treeRows(page)).toHaveText([
      "Empty folder",
      "Journal",
      "Projects",
      "Welcome",
      "Zażółć gęślą jaźń",
    ]);
  });

  await test.step("expanding and collapsing folders", async () => {
    await expect(page.getByRole("treeitem", { name: "commitnote" })).toHaveCount(
      0,
    );
    await page.getByRole("treeitem", { name: "Projects" }).click();
    await expect(page.getByRole("treeitem", { name: "commitnote" })).toBeVisible();

    await expect(page.getByRole("treeitem", { name: "Ideas" })).toHaveCount(0);
    await page.getByRole("treeitem", { name: "commitnote" }).click();
    await expect(page.getByRole("treeitem", { name: "Ideas" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Roadmap" })).toBeVisible();
  });

  await test.step("a reordered folder lists its notes in the stored order", async () => {
    await expect(treeRows(page)).toHaveText([
      "Empty folder",
      "Journal",
      "Projects",
      "commitnote",
      "Roadmap",
      "Ideas",
      "Welcome",
      "Zażółć gęślą jaźń",
    ]);
  });

  await page.getByRole("treeitem", { name: "commitnote" }).click();
  await expect(page.getByRole("treeitem", { name: "Ideas" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Roadmap" })).toHaveCount(0);
});

test("tree and note are both visible on desktop", async ({ page }) => {
  await openNotes(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
});

test("opening a note hides the tree on mobile", { tag: "@mobile-only" }, async ({ page }) => {
  await openNotes(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
  await expect(page.getByRole("tree", { name: "Notes" })).toBeHidden();

  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Welcome" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const rows = await page.getByRole("treeitem").all();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("only the page's own origin is contacted", async ({ page, baseURL }) => {
  const origins = new Set<string>();
  page.on("request", (request) => {
    origins.add(new URL(request.url()).origin);
  });

  await openNotes(page);

  await page.getByRole("treeitem", { name: "Projects" }).click();
  await page.getByRole("treeitem", { name: "commitnote" }).click();
  await page.getByRole("treeitem", { name: "Ideas" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText("Ideas");

  expect([...origins]).toEqual([new URL(baseURL!).origin]);
});
