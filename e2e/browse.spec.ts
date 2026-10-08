import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree } from "./helpers";
import { openRowMenu, openWelcome, treeItem, treeRows } from "./helpers/tree";


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

test("collapsed folders show their recursive note count without changing the row name", async ({
  page,
}) => {
  await openNotes(page);

  const count = (name: string) =>
    treeItem(page, name).locator(".tree-row-count");

  await expect(count("Empty folder")).toBeVisible();
  await expect(count("Empty folder")).toHaveAttribute("data-count", "0");
  await expect(count("Journal")).toHaveAttribute("data-count", "1");
  await expect(count("Projects")).toHaveAttribute("data-count", "2");

  await treeItem(page, "Projects").click();
  await expect(treeItem(page, "commitnote")).toBeVisible();
  await expect(count("Projects")).toHaveCount(0);
  await expect(count("Journal")).toHaveCount(1);
  await expect(treeItem(page, "Projects")).toBeVisible();
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

    await openRowMenu(page, "Welcome");
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

test("opening a note moves focus to Back to notes and hides the tree from the keyboard", {
  tag: "@mobile-only",
}, async ({ page }) => {
  await openNotes(page);
  await treeItem(page, "Welcome").click();

  await expect(page.getByRole("button", { name: "Back to notes" })).toBeFocused();
  await expect(page.locator("nav#sidebar")).toHaveAttribute("inert", "");
  await expect(page.locator("main#note-pane")).not.toHaveAttribute("inert");
});

test("going back to the tree moves focus to a treeitem and hides the note pane from the keyboard", {
  tag: "@mobile-only",
}, async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);

  await page.getByRole("button", { name: "Back to notes" }).click();

  await expect(page.locator('[role="treeitem"][tabindex="0"]')).toBeFocused();
  await expect(page.locator("main#note-pane")).toHaveAttribute("inert", "");
  await expect(page.locator("nav#sidebar")).not.toHaveAttribute("inert");
});

test("opening a search result moves focus to Back to notes", {
  tag: "@mobile-only",
}, async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Search notes" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("combobox", { name: "Search notes" }).fill("Welcome");
  await expect(page.getByRole("option", { name: /Welcome/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to notes" })).toBeFocused();
});

test("restoring a note on load does not move focus to Back to notes", {
  tag: "@mobile-only",
}, async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  const url = page.url();

  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Back to notes" })).not.toBeFocused();
  await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(0);
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

async function focusDocumentStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
}

test("the skip link moves focus to the note editor", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await focusDocumentStart(page);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to note" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeFocused();
});

test("the skip link focuses the main landmark when no note is open", async ({ page }) => {
  await openNotes(page);
  await focusDocumentStart(page);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to note" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("the notes screen has navigation, main and a heading landmark structure", async ({
  page,
}) => {
  await openNotes(page);

  const navigation = page.getByRole("navigation", { name: "Notes" });
  await expect(navigation.getByRole("tree", { name: "Notes" })).toBeVisible();
  await expect(navigation.getByRole("separator", { name: "Resize sidebar" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "commitnote" })).toHaveCount(1);
});

test("on a narrow screen the skip link is hidden and each view has its landmark", { tag: "@mobile" }, async ({
  page,
}) => {
  await openNotes(page);
  const narrow = (page.viewportSize()?.width ?? 0) < 768;
  test.skip(!narrow, "narrow viewports only");

  await expect(page.getByRole("link", { name: "Skip to note" })).toBeHidden();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("main").getByRole("navigation", { name: "Notes" }),
  ).toBeVisible();
  await openWelcome(page);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Notes" })).toBeHidden();
});

test.describe("tree keyboard", () => {
  async function tabIntoTree(page: Page): Promise<void> {
    await focusDocumentStart(page);
    const focusedTreeitem = page.locator('[role="treeitem"]:focus');
    for (let presses = 0; presses < 30; presses++) {
      await page.keyboard.press("Tab");
      if ((await focusedTreeitem.count()) > 0) return;
    }
    throw new Error("Tab never reached the tree");
  }

  test("the tree is one tab stop with a roving row and valid children", async ({ page }) => {
    await openNotes(page);
    const tree = page.getByRole("tree", { name: "Notes" });

    await tabIntoTree(page);
    await expect(treeItem(page, "Empty folder")).toBeFocused();
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
    await expect(tree.getByRole("button")).toHaveCount(0);
    await expect(tree.getByRole("img")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await expect(treeItem(page, "Empty folder")).toBeFocused();
  });

  test("arrow keys, Home, End and type-ahead move through the rows", async ({ page }) => {
    await openNotes(page);
    await treeItem(page, "Journal").focus();

    await page.keyboard.press("ArrowDown");
    await expect(treeItem(page, "Projects")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(treeItem(page, "Journal")).toBeFocused();
    await page.keyboard.press("End");
    await expect(treeItem(page, "Zażółć gęślą jaźń")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(treeItem(page, "Empty folder")).toBeFocused();

    const projects = treeItem(page, "Projects");
    await page.keyboard.press("p");
    await expect(projects).toBeFocused();
    await expect(projects).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(projects).toHaveAttribute("aria-expanded", "true");
    await expect(projects).toBeFocused();
    await page.keyboard.press("ArrowRight");
    const child = treeItem(page, "commitnote");
    await expect(child).toBeFocused();
    await expect(child).toHaveAttribute("aria-level", "2");
    await expect(child).toHaveAttribute("aria-posinset", "1");
    await expect(child).toHaveAttribute("aria-setsize", "1");
    await page.keyboard.press("ArrowLeft");
    await expect(projects).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(projects).toHaveAttribute("aria-expanded", "false");
    await expect(projects).toBeFocused();

    const welcome = treeItem(page, "Welcome");
    await expect(welcome).toHaveAttribute("aria-level", "1");
    await expect(welcome).toHaveAttribute("aria-posinset", "4");
    await expect(welcome).toHaveAttribute("aria-setsize", "5");

    await page.keyboard.type("we");
    await expect(welcome).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Note editor" })).toHaveCount(0);
  });

  test("Enter opens the focused note, which is the tab stop when the tree is entered", async ({
    page,
  }) => {
    await openNotes(page);
    const welcome = treeItem(page, "Welcome");
    await treeItem(page, "Journal").focus();
    await page.keyboard.press("w");
    await expect(welcome).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Welcome");
    await expect(welcome).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#n=/);

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Welcome");
    await tabIntoTree(page);
    await expect(welcome).toBeFocused();
    await expect(
      page.getByRole("tree", { name: "Notes" }).locator('[role="treeitem"][tabindex="0"]'),
    ).toHaveCount(1);
  });
});
