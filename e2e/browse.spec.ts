import { test, expect } from "./fixtures";
import { openNotes, showTree } from "./helpers";
import { openWelcome, treeItem, treeRows } from "./helpers/tree";


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

test.describe("selected note", () => {
  test.use({ forgeLatency: "github" });

  test("clicking the selected note does not reload it", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    const editor = page.getByRole("textbox", { name: "Note editor" });
    await editor.click();
    await page.keyboard.press("Control+End");

    const readSelection = () =>
      page.evaluate(() => {
        const sel = window.getSelection();
        return {
          text: sel?.anchorNode?.textContent ?? null,
          offset: sel?.anchorOffset ?? null,
        };
      });
    const before = await readSelection();
    await page.evaluate(() => {
      const flag = { loading: false };
      (window as unknown as { __loading: typeof flag }).__loading = flag;
      new MutationObserver(() => {
        if (document.querySelector(".note-status")) flag.loading = true;
      }).observe(document.body, { childList: true, subtree: true });
    });

    const row = treeItem(page, "Welcome");
    await expect(row).toHaveAttribute("aria-selected", "true");
    await row.click();
    await row.click();

    await expect(editor).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __loading: { loading: boolean } }).__loading.loading,
      ),
    ).toBe(false);
    expect(await readSelection()).toEqual(before);
    await expect(row).toHaveAttribute("aria-selected", "true");
  });

  test("the selected row keeps its context menu", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    const row = treeItem(page, "Welcome");

    await page.getByRole("button", { name: "Actions for Welcome" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Move to trash…" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: "Move to trash…" }),
    ).toHaveCount(0);

    await row.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Move to trash…" }),
    ).toBeVisible();
  });
});

test("tapping the selected note returns to the note view", { tag: "@mobile-only" }, async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  await showTree(page);
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();

  await treeItem(page, "Welcome").click();
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Notes" })).toBeHidden();
});
