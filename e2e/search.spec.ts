import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { TouchFinger, openNotes, showTree } from "./helpers";
import { moveToTrash, treeItem } from "./helpers/tree";

const SEARCH_REPO = "https://github.com/sample/search";
const SAMPLE_TRASH_NOW = new Date("2026-09-30T12:00:00Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(SAMPLE_TRASH_NOW);
  await openNotes(page, { repo: SEARCH_REPO });
});

function palette(page: Page): Locator {
  return page.getByRole("dialog", { name: "Search notes" });
}

function searchInput(page: Page): Locator {
  return palette(page).getByRole("combobox", { name: "Search notes" });
}

function results(page: Page): Locator {
  return palette(page).getByRole("listbox", { name: "Search results" });
}

function group(page: Page, heading: string): Locator {
  return results(page).getByRole("group", { name: heading, exact: true });
}

async function openPalette(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Search notes" }).click();
  await expect(searchInput(page)).toBeFocused();
}

async function search(page: Page, query: string): Promise<void> {
  await searchInput(page).fill(query);
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect(page.locator(".cm-content")).toBeFocused();
}

test("titles are found by name, folder and folded text, and opening one reveals it", async ({
  page,
}) => {
  await openPalette(page);

  await search(page, "road");
  const titles = group(page, "Titles");
  const roadmap = titles.getByRole("option").first();
  await expect(roadmap).toContainText("Roadmap");
  await expect(roadmap.locator(".option-name mark")).toHaveText("Road");
  await expect(roadmap.locator(".option-folder")).toHaveText(
    "Projects / commitnote",
  );
  await expect(roadmap).toContainText("Blue tag");
  await expect(results(page).getByText("Old roadmap")).toHaveCount(0);

  await search(page, "proj road");
  await expect(titles.getByRole("option").first()).toContainText("Roadmap");

  await search(page, "zazolc");
  await expect(
    titles.getByRole("option", { name: /Zażółć gęślą jaźń/ }),
  ).toBeVisible();

  await search(page, "road");
  await expect(group(page, "Contents")).toBeVisible();
  const options = results(page).getByRole("option");
  await expect(options).not.toHaveCount(1);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(options.first()).toContainText("Roadmap");

  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(treeItem(page, "Roadmap")).toBeVisible();
  await expect(treeItem(page, "Roadmap")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Roadmap",
  );
  await expectEditorFocused(page);
});

test("the search trigger opens the palette from the editor, Escape returns focus, and Ctrl+K does nothing", async ({
  page,
}) => {
  await treeItem(page, "Welcome").click();
  await page.locator(".cm-content").click();
  await expectEditorFocused(page);

  await openPalette(page);
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search notes" })).toBeFocused();

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+K");
  await expect(palette(page)).toHaveCount(0);
  await expectEditorFocused(page);
});

test("contents are searched with snippets, ignore the trash and include unsaved edits", async ({
  page,
}) => {
  await openPalette(page);

  await search(page, "lighthouse");
  const contents = group(page, "Contents");
  await expect(contents).toBeVisible();
  const rows = contents.getByRole("option");
  await expect(rows).toHaveCount(5);
  for (const name of [
    "February",
    "January",
    "Lisbon",
    "Reading list",
    "Welcome",
  ]) {
    await expect(
      rows.filter({ has: page.locator(".option-name", { hasText: name }) }),
    ).toHaveCount(1);
  }
  await expect(results(page).getByRole("group", { name: "Titles" })).toHaveCount(
    0,
  );
  for (const row of await rows.all()) {
    await expect(row.locator(".option-snippet mark").first()).toBeVisible();
  }

  await search(page, "kingfisher");
  await expect(rows).toHaveCount(1);
  const snippet = rows.first().locator(".option-snippet");
  await expect(rows.first()).toContainText("Meeting minutes");
  await expect(snippet).toHaveText(/^….*kingfisher.*…$/s);

  await search(page, "quasar");
  await expect(page.getByText("No notes match “quasar”")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);

  await treeItem(page, "Welcome").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("zebracorn");
  await openPalette(page);
  await search(page, "zebracorn");
  await expect(group(page, "Contents")).toBeVisible();
  await expect(
    group(page, "Contents")
      .getByRole("option")
      .filter({ has: page.locator(".option-name", { hasText: "Welcome" }) }),
  ).toHaveCount(1);
});

test.describe("while notes are still being read", () => {
  test.use({ forgeLatency: "github" });

  test("the palette shows indexing progress and a partial contents section until done", async ({
    page,
  }) => {
    await openPalette(page);
    await search(page, "lighthouse");

    const status = palette(page).locator(".search-status-text");
    await expect(status).toHaveText(
      /Reading notes for content search… \d+ of 13/,
    );
    await expect(
      results(page).getByRole("group", { name: "Contents (partial)" }),
    ).toBeVisible();

    await expect(status).toHaveCount(0);
    await expect(
      results(page).getByRole("group", { name: "Contents", exact: true }),
    ).toBeVisible();
    await expect(
      results(page).getByRole("group", { name: "Contents (partial)" }),
    ).toHaveCount(0);
  });
});

test("the palette is a full-screen sheet that opens a result and closes by swipe", {
  tag: "@mobile-only",
}, async ({ page }) => {
  await page.getByRole("button", { name: "Search notes" }).tap();
  const dialog = palette(page);
  await expect(searchInput(page)).toBeFocused();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await dialog.locator(".dialog-card").boundingBox();
      return box === null
        ? null
        : [box.x, box.y, box.width, box.height].map(Math.round);
    })
    .toEqual([0, 0, viewport.width, viewport.height]);

  await search(page, "pierogi");
  await results(page).getByRole("option", { name: /Pierogi/ }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Pierogi",
  );
  await expect(treeItem(page, "Pierogi")).toBeHidden();

  await showTree(page);
  await page.getByRole("button", { name: "Search notes" }).tap();
  await expect(dialog).toBeVisible();
  const header = (await dialog.locator(".dialog-header").boundingBox())!;
  const title = (await dialog.locator(".dialog-title").boundingBox())!;
  const card = (await dialog.locator(".dialog-card").boundingBox())!;
  const grab = {
    x: title.x + title.width + 24,
    y: header.y + header.height / 2,
  };
  const finger = await TouchFinger.on(page);
  await finger.down(grab);
  await finger.move({ x: grab.x, y: grab.y + card.height * 0.6 }, 20);
  finger.hold(150);
  await finger.up();
  await expect(dialog).toHaveCount(0);
});

test.describe("recent notes", () => {
  const noteName = (page: Page) =>
    page.getByRole("textbox", { name: "Note name" });

  async function openThreeNotes(page: Page): Promise<void> {
    for (const name of ["Reading list", "Welcome", "Zażółć gęślą jaźń"]) {
      await treeItem(page, name).click();
      await expect(noteName(page)).toHaveValue(name);
    }
  }

  test("the hint shows when no note was opened", async ({ page }) => {
    await openPalette(page);

    await expect(palette(page).getByText("Search note titles and contents")).toBeVisible();
    await expect(group(page, "Recent")).toHaveCount(0);
    await expect(searchInput(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("lists previously opened notes most recent first without the open note, and Enter opens the first", async ({
    page,
  }) => {
    await openThreeNotes(page);
    await openPalette(page);

    const recent = group(page, "Recent").getByRole("option");
    await expect(recent).toHaveCount(2);
    await expect(recent.nth(0)).toContainText("Welcome");
    await expect(recent.nth(1)).toContainText("Reading list");
    await expect(recent.first()).toHaveAttribute("aria-selected", "true");
    await expect(palette(page).getByText("Search note titles and contents")).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect(noteName(page)).toHaveValue("Welcome");
    await expectEditorFocused(page);

    await openPalette(page);
    await expect(recent.nth(0)).toContainText("Zażółć gęślą jaźń");
    await expect(recent.nth(1)).toContainText("Reading list");
  });

  test("arrow keys and clicks open recent notes", async ({ page }) => {
    await openThreeNotes(page);
    await openPalette(page);

    const recent = group(page, "Recent").getByRole("option");
    await page.keyboard.press("ArrowDown");
    await expect(recent.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(noteName(page)).toHaveValue("Reading list");

    await openPalette(page);
    await group(page, "Recent")
      .getByRole("option", { name: /Zażółć gęślą jaźń/ })
      .click();
    await expect(palette(page)).toHaveCount(0);
    await expect(noteName(page)).toHaveValue("Zażółć gęślą jaźń");
  });

  test("typing replaces the recent notes with search results", async ({ page }) => {
    await openThreeNotes(page);
    await openPalette(page);
    await expect(group(page, "Recent")).toBeVisible();

    await search(page, "reading");
    await expect(group(page, "Recent")).toHaveCount(0);
    await expect(group(page, "Titles")).toBeVisible();

    await search(page, "");
    await expect(group(page, "Recent")).toBeVisible();
  });

  test("a trashed note is no longer listed", async ({ page }) => {
    await openThreeNotes(page);
    await moveToTrash(page, "Reading list");

    await openPalette(page);
    const recent = group(page, "Recent").getByRole("option");
    await expect(recent).toHaveCount(1);
    await expect(recent.first()).toContainText("Welcome");
  });

  test("recent notes open by tap on mobile", { tag: "@mobile" }, async ({ page }) => {
    await treeItem(page, "Welcome").click();
    await expect(noteName(page)).toHaveValue("Welcome");
    await showTree(page);
    await treeItem(page, "Reading list").click();
    await expect(noteName(page)).toHaveValue("Reading list");
    await showTree(page);

    await openPalette(page);
    const recent = group(page, "Recent").getByRole("option");
    await expect(recent).toHaveCount(1);
    await recent.first().click();
    await expect(palette(page)).toHaveCount(0);
    await expect(noteName(page)).toHaveValue("Welcome");
  });
});
