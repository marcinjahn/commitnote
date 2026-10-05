import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

test("root notes list in order", async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  const rows = page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
  await expect(rows).toHaveText([
    "Empty folder",
    "Journal",
    "Projects",
    "Welcome",
    "Zażółć gęślą jaźń",
  ]);
});

test("a reordered folder lists its notes in the stored order", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Projects" }).click();
  await page.getByRole("treeitem", { name: "commitnote" }).click();

  const rows = page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
  await expect(rows).toHaveText([
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

test("expanding and collapsing folders", async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await expect(page.getByRole("treeitem", { name: "commitnote" })).toHaveCount(
    0,
  );
  await page.getByRole("treeitem", { name: "Projects" }).click();
  await expect(page.getByRole("treeitem", { name: "commitnote" })).toBeVisible();

  await expect(page.getByRole("treeitem", { name: "Ideas" })).toHaveCount(0);
  await page.getByRole("treeitem", { name: "commitnote" }).click();
  await expect(page.getByRole("treeitem", { name: "Ideas" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Roadmap" })).toBeVisible();

  await page.getByRole("treeitem", { name: "commitnote" }).click();
  await expect(page.getByRole("treeitem", { name: "Ideas" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Roadmap" })).toHaveCount(0);
});

test("opening the Welcome note", async ({ page }, testInfo) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toContainText("Welcome");
  await expect(editor).toContainText("commitnote project");
  await expect(editor).toContainText("Column A");

  // On mobile, opening a note hides the tree entirely (covered by its own
  // test below), so the row can't be inspected until the tree is visible
  // again.
  if (testInfo.project.name === "desktop") {
    await expect(
      page.getByRole("treeitem", { name: "Welcome" }),
    ).toHaveAttribute("aria-selected", "true");
  }
});

test("tree and note are both visible on desktop", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only layout");

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toBeVisible();
});

test("opening a note hides the tree on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout");

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

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

test("refresh keeps the tree visible", async ({ page }) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
});

test("only the page's own origin is contacted", async ({ page, baseURL }) => {
  const origins = new Set<string>();
  page.on("request", (request) => {
    origins.add(new URL(request.url()).origin);
  });

  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Projects" }).click();
  await page.getByRole("treeitem", { name: "commitnote" }).click();
  await page.getByRole("treeitem", { name: "Ideas" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText("Ideas");

  expect([...origins]).toEqual([new URL(baseURL!).origin]);
});
