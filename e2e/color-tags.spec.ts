import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  SAMPLE,
  TouchFinger,
  expectTree,
  fakeForge,
  handOverRepo,
  logIn,
  openNotes,
  showTree,
} from "./helpers";
import {
  moveToTrash,
  openTrash,
  openWelcome,
  restoreTo,
  trashRow,
  treeItem,
  treeRows,
  waitForSynced,
  openRowMenu,
} from "./helpers/tree";

const COLORS = {
  Red: "rgb(206, 44, 49)",
  Orange: "rgb(204, 78, 0)",
  Yellow: "rgb(154, 103, 0)",
  Green: "rgb(33, 131, 88)",
  Blue: "rgb(51, 88, 212)",
  Purple: "rgb(138, 70, 184)",
} as const;

const PURPLE_NOTE = "Zażółć gęślą jaźń";

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

function rowMenu(page: Page, name: string): Locator {
  return page.getByRole("menu", { name: `Actions for ${name}` });
}

function swatch(menu: Locator, label: string): Locator {
  return menu.getByRole("group", { name: "Color tag" }).getByRole("menuitemradio", {
    name: label,
    exact: true,
  });
}

function rowIcon(page: Page, name: string): Locator {
  return treeItem(page, name).locator("svg.note-icon");
}

async function tagFromRowMenu(
  page: Page,
  name: string,
  label: string,
): Promise<void> {
  await treeItem(page, name).click({ button: "right" });
  await swatch(rowMenu(page, name), label).click();
  await expect(rowMenu(page, name)).toHaveCount(0);
}

async function expectTagged(
  page: Page,
  name: string,
  label: keyof typeof COLORS,
): Promise<void> {
  await expect(treeItem(page, name)).toHaveAccessibleDescription(
    new RegExp(`${label} tag`),
  );
  await expect(rowIcon(page, name)).toHaveClass(/tag-colored/);
  await expect(rowIcon(page, name)).toHaveCSS("color", COLORS[label]);
}

function headerColorButton(page: Page): Locator {
  return page.getByRole("button", { name: "Color tag" });
}

test("picking a color from the row context menu tags the note", async ({ page }) => {
  await tagFromRowMenu(page, "Welcome", "Red");

  await expectTagged(page, "Welcome", "Red");

  await treeItem(page, "Welcome").click({ button: "right" });
  await expect(swatch(rowMenu(page, "Welcome"), "Red")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("the fixture notes show their tag colors", async ({ page }) => {
  await expectTagged(page, PURPLE_NOTE, "Purple");
  await expect(treeItem(page, "Welcome")).not.toHaveAccessibleDescription(
    /tag/,
  );
  await expect(rowIcon(page, "Welcome")).not.toHaveClass(/tag-colored/);
});

test("right-clicking a nested note opens that note's own menu", async ({ page }) => {
  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();

  await treeItem(page, "Roadmap").click({ button: "right" });

  await expect(rowMenu(page, "Roadmap")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(swatch(rowMenu(page, "Roadmap"), "Blue")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await swatch(rowMenu(page, "Roadmap"), "Red").click();

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expectTagged(page, "Roadmap", "Red");
});

test("a folder menu offers no color swatches", async ({ page }) => {
  await treeItem(page, "Journal").click({ button: "right" });
  await expect(rowMenu(page, "Journal")).toBeVisible();
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);
});

test("No color from the ⋯ button removes a tag", async ({ page }) => {
  await expectTagged(page, PURPLE_NOTE, "Purple");

  await openRowMenu(page, PURPLE_NOTE);
  await swatch(rowMenu(page, PURPLE_NOTE), "No color").click();

  await expect(treeItem(page, PURPLE_NOTE)).not.toHaveAccessibleDescription(
    /Purple tag/,
  );
  await expect(rowIcon(page, PURPLE_NOTE)).not.toHaveClass(/tag-colored/);
});

test("tagging from the note header persists across reload", async ({ page }) => {
  await openWelcome(page);
  const button = headerColorButton(page);
  await expect(button).toHaveAccessibleDescription("No color");

  await button.click();
  await swatch(page.getByRole("menu", { name: "Color tag" }), "Green").click();

  await expect(button).toHaveAccessibleDescription("Green tag");
  await expectTagged(page, "Welcome", "Green");

  await waitForSynced(page);
  const saved = await fakeForge(page).exportRepo();
  await page.reload();
  await expectTree(page);
  await fakeForge(page).adoptRepo(saved);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expectTagged(page, "Welcome", "Green");
  await treeItem(page, "Welcome").click();
  await expect(headerColorButton(page)).toHaveAccessibleDescription("Green tag");
});

test("rapid tag changes land in a single commit without color names", async ({
  page,
}) => {
  const commits = await fakeForge(page).commitCount();

  await tagFromRowMenu(page, "Welcome", "Red");
  await tagFromRowMenu(page, "Welcome", "Blue");
  await tagFromRowMenu(page, "Welcome", "Green");
  await expectTagged(page, "Welcome", "Green");
  await openWelcome(page);
  await waitForSynced(page);

  await expect.poll(() => fakeForge(page).commitCount()).toBe(commits + 1);
  const messages = await fakeForge(page).commitMessages();
  expect(messages.at(-1)).not.toMatch(/red|green|blue|orange|yellow|purple/i);
});

test("a tag syncs to a second device", async ({ page, openSecondDevice }) => {
  await tagFromRowMenu(page, "Welcome", "Blue");
  await openWelcome(page);
  await waitForSynced(page);

  const { page: other } = await openSecondDevice();
  await logIn(other, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(other);
  await handOverRepo(page, other);
  await other.getByRole("button", { name: "Refresh" }).click();

  await expectTagged(other, "Welcome", "Blue");
});

test("a tagged note keeps its tag when renamed", async ({ page }) => {
  await treeItem(page, PURPLE_NOTE).click();
  const name = page.getByRole("textbox", { name: "Note name" });
  await name.fill("Renamed tagged");
  await name.press("Enter");
  await showTree(page);

  await expect(treeItem(page, PURPLE_NOTE)).toHaveCount(0);
  await expectTagged(page, "Renamed tagged", "Purple");
});

async function expectTrashTagged(
  page: Page,
  name: string,
  label: keyof typeof COLORS,
): Promise<void> {
  await expect(
    page.getByRole("button", { name: `Restore ${name} to…`, exact: true }),
  ).toHaveAccessibleDescription(`${label} tag`);
  const icon = trashRow(page, name).locator("svg.note-icon");
  await expect(icon).toHaveClass(/tag-colored/);
  await expect(icon).toHaveCSS("color", COLORS[label]);
}

test("a trashed tagged note shows its color in the trash and keeps it on restore", async ({
  page,
}) => {
  await moveToTrash(page, "Welcome");
  await moveToTrash(page, PURPLE_NOTE);
  await expect(treeItem(page, PURPLE_NOTE)).toHaveCount(0);

  await openTrash(page);
  await expectTrashTagged(page, PURPLE_NOTE, "Purple");
  await expect(
    page.getByRole("button", { name: "Restore Welcome to…", exact: true }),
  ).not.toHaveAccessibleDescription(/tag/);
  await expect(trashRow(page, "Welcome").locator("svg.note-icon")).not.toHaveClass(
    /tag-colored/,
  );

  await restoreTo(page, PURPLE_NOTE, "Notes (top level)");

  await expectTagged(page, PURPLE_NOTE, "Purple");
});

test("notes inside a trashed folder show their colors in the trash", async ({
  page,
}) => {
  await treeItem(page, "Projects").click();
  await moveToTrash(page, "commitnote", /and everything in it/);
  await openWelcome(page);
  await waitForSynced(page);
  const saved = await fakeForge(page).exportRepo();
  await page.reload();
  await expectTree(page);
  await fakeForge(page).adoptRepo(saved);
  await page.getByRole("button", { name: "Refresh" }).click();

  const dialog = await openTrash(page);
  await dialog.getByRole("button", { name: /^commitnote/ }).click();
  await expectTrashTagged(page, "Roadmap", "Blue");
  await expectTrashTagged(page, "Ideas", "Green");
  await expect(
    page.getByRole("button", { name: "Restore commitnote to…", exact: true }),
  ).not.toHaveAccessibleDescription(/tag/);
  await expect(trashRow(page, "commitnote").locator("svg.note-icon")).toHaveCount(0);

  await restoreTo(page, "Roadmap", "Notes (top level)");
  await expectTrashTagged(page, "Ideas", "Green");
  await dialog.getByRole("button", { name: "Close" }).click();

  await expectTagged(page, "Roadmap", "Blue");
});

test("the color picker is operable from the keyboard", async ({ page }) => {
  const menu = await openRowMenu(page, "Welcome");
  await expect(swatch(menu, "No color")).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(swatch(menu, "Purple")).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(menu).toHaveCount(0);
  await expect(treeItem(page, "Welcome")).toBeFocused();
  await expectTagged(page, "Welcome", "Purple");

  await openRowMenu(page, "Welcome");
  await expect(menu).toBeVisible();
  await expect(swatch(menu, "Purple")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(treeItem(page, "Welcome")).toBeFocused();
});

test("the header color button is a touch-sized target", { tag: "@mobile" }, async ({
  page,
}) => {
  await openWelcome(page);
  const button = headerColorButton(page);
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await button.click();
  await swatch(page.getByRole("menu", { name: "Color tag" }), "Orange").click();
  await expect(button).toHaveAccessibleDescription("Orange tag");

  await showTree(page);
  await expectTagged(page, "Welcome", "Orange");
});

test("long-pressing a row opens a menu that can tag it", { tag: "@mobile-only" }, async ({
  page,
}) => {
  const box = (await treeItem(page, "Welcome").boundingBox())!;
  const finger = await TouchFinger.on(page);
  await finger.down({ x: box.x + 40, y: box.y + box.height / 2 });
  await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
  await finger.up();

  const menu = rowMenu(page, "Welcome");
  await expect(menu).toBeVisible();
  await swatch(menu, "Yellow").tap();

  await expect(menu).toHaveCount(0);
  await expectTagged(page, "Welcome", "Yellow");
});

function filterButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Filter by color/ });
}

function filterMenu(page: Page): Locator {
  return page.getByRole("menu", { name: "Filter by color" });
}

function filterChip(page: Page, label: string): Locator {
  return page.getByText(`Showing: ${label}`, { exact: true });
}

function clearFilter(page: Page): Locator {
  return page.getByRole("button", { name: "Clear color filter" });
}

function filterOption(page: Page, label: string): Locator {
  return filterMenu(page).getByRole("menuitemradio", { name: label, exact: true });
}

async function filterBy(page: Page, label: string): Promise<void> {
  await filterButton(page).click();
  await filterOption(page, label).click();
  await expect(filterMenu(page)).toHaveCount(0);
}

async function expand(page: Page, name: string): Promise<void> {
  await treeItem(page, name).click();
  await expect(treeItem(page, name)).toHaveAttribute("aria-expanded", "true");
}

test.describe("tag filter", () => {
  test("menu lists the used colors in palette order", async ({ page }) => {
    const names = ["All notes", "Orange", "Green", "Blue", "Purple"];
    await filterButton(page).click();
    const items = filterMenu(page).getByRole("menuitemradio");
    await expect(items).toHaveCount(names.length);
    for (const [i, name] of names.entries()) {
      await expect(items.nth(i)).toHaveAccessibleName(name);
    }
    await expect(items.first()).toHaveAttribute("aria-checked", "true");
    await expect(filterButton(page)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(filterMenu(page)).toHaveCount(0);

    await tagFromRowMenu(page, "Welcome", "Red");
    await filterButton(page).click();
    await expect(items).toHaveCount(names.length + 1);
    await expect(items.nth(0)).toHaveAccessibleName("All notes");
    await expect(items.nth(1)).toHaveAccessibleName("Red");
  });

  test("filters to the tagged note and restores the expansion", async ({ page }) => {
    await expand(page, "Projects");

    await filterBy(page, "Purple");
    await expect(filterButton(page)).toHaveAccessibleName("Filter by color: Purple");
    await expect(filterChip(page, "Purple")).toBeVisible();
    await expect(treeRows(page)).toHaveCount(1);
    await expect(treeItem(page, PURPLE_NOTE)).toBeVisible();
    await expect(treeItem(page, "Welcome")).toBeHidden();

    await filterButton(page).click();
    await expect(filterOption(page, "Purple")).toHaveAttribute("aria-checked", "true");
    await expect(filterOption(page, "All notes")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await page.keyboard.press("Escape");

    await clearFilter(page).click();
    await expect(filterChip(page, "Purple")).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName("Filter by color");
    await expect(filterButton(page)).toBeFocused();
    await expect(treeItem(page, "Welcome")).toBeVisible();
    await expect(treeItem(page, "Projects")).toHaveAttribute("aria-expanded", "true");
    await expect(treeItem(page, "Journal")).toHaveAttribute("aria-expanded", "false");
  });

  test("All notes clears the filter and focuses the button", async ({ page }) => {
    await filterBy(page, "Purple");
    await expect(treeItem(page, "Welcome")).toBeHidden();

    await filterBy(page, "All notes");
    await expect(filterChip(page, "Purple")).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName("Filter by color");
    await expect(filterButton(page)).toBeFocused();
    await expect(treeItem(page, "Welcome")).toBeVisible();
  });

  test("works from the keyboard", async ({ page }) => {
    await filterButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(filterMenu(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(filterOption(page, "Green")).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(filterMenu(page)).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName("Filter by color: Green");
    await expect(filterChip(page, "Green")).toBeVisible();
    await expect(filterButton(page)).toBeFocused();
  });

  test("shows ancestors expanded and restores collapsed folders", async ({ page }) => {
    await expand(page, "Projects");
    await expand(page, "commitnote");
    await tagFromRowMenu(page, "Ideas", "Purple");
    await treeItem(page, "Projects").click();
    await expect(treeItem(page, "Projects")).toHaveAttribute("aria-expanded", "false");

    await filterBy(page, "Purple");
    await expect(treeItem(page, "Projects")).toHaveAttribute("aria-expanded", "true");
    await expect(treeItem(page, "commitnote")).toHaveAttribute("aria-expanded", "true");
    await expect(treeItem(page, "Ideas")).toBeVisible();
    await expect(treeItem(page, "Roadmap")).toBeHidden();

    await clearFilter(page).click();
    await expect(treeItem(page, "Projects")).toHaveAttribute("aria-expanded", "false");
    await expect(treeItem(page, "Ideas")).toBeHidden();
  });

  test("blocks tree drag but keeps row menus", async ({ page }) => {
    await filterBy(page, "Purple");
    const row = treeItem(page, PURPLE_NOTE);
    const box = (await row.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + box.height / 2 + 8, { steps: 4 });
    await page.mouse.move(box.x + 40, box.y + box.height / 2 + 40, { steps: 4 });
    await expect(page.locator("[data-drag-state]")).toHaveCount(0);
    await page.mouse.up();

    await row.click({ button: "right" });
    await expect(rowMenu(page, PURPLE_NOTE)).toBeVisible();
  });

  test("keeps the open note open", async ({ page }) => {
    await openWelcome(page);
    await filterBy(page, "Purple");
    await expect(treeItem(page, "Welcome")).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Welcome",
    );
  });

  test("clears when its color is no longer used", async ({ page }) => {
    await filterBy(page, "Purple");
    await treeItem(page, PURPLE_NOTE).click({ button: "right" });
    await swatch(rowMenu(page, PURPLE_NOTE), "No color").click();

    await expect(filterChip(page, "Purple")).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName("Filter by color");
    await expect(treeItem(page, "Welcome")).toBeVisible();
    await filterButton(page).click();
    await expect(filterOption(page, "Purple")).toHaveCount(0);
  });

  test("clears when a note is created", async ({ page }) => {
    await filterBy(page, "Purple");
    await expect(treeItem(page, "Welcome")).toBeHidden();
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(filterChip(page, "Purple")).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName("Filter by color");
    await expect(treeItem(page, "Welcome")).toBeVisible();
  });

  test("the button is absent while no color is in use", async ({ page }) => {
    const tagged = treeRows(page).filter({
      has: page.locator("svg.note-icon.tag-colored"),
    });
    while (await filterButton(page).isVisible()) {
      await filterButton(page).click();
      await filterMenu(page).getByRole("menuitemradio").nth(1).click();
      await tagged.first().click({ button: "right" });
      await swatch(page.getByRole("menu", { name: /^Actions for / }), "No color").click();
    }
    await expect(filterButton(page)).toHaveCount(0);
    await expect(treeItem(page, "Welcome")).toBeVisible();
  });

  test("controls are touch sized on mobile", { tag: "@mobile-only" }, async ({ page }) => {
    await showTree(page);
    await expectTouchSized(filterButton(page));
    await filterButton(page).click();
    await expect(filterMenu(page)).toBeVisible();
    const items = filterMenu(page).getByRole("menuitemradio");
    for (let i = 0; i < (await items.count()); i++) {
      await expectTouchSized(items.nth(i));
    }
    await filterOption(page, "Purple").click();
    await expect(filterChip(page, "Purple")).toBeVisible();
    await expectTouchSized(clearFilter(page));
  });

  test("long-press opens a row menu while filtered", { tag: "@mobile" }, async ({
    page,
  }) => {
    await showTree(page);
    await filterBy(page, "Purple");
    await expect(filterChip(page, "Purple")).toBeVisible();

    const box = (await treeItem(page, PURPLE_NOTE).boundingBox())!;
    const finger = await TouchFinger.on(page);
    await page.clock.install();
    await finger.down({ x: box.x + 40, y: box.y + box.height / 2 });
    await page.clock.runFor(600);
    await expect(page.locator("[data-drag-state]")).toHaveCount(0);
    await finger.up();

    await expect(rowMenu(page, PURPLE_NOTE)).toBeVisible();
    await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(0);
  });
});

async function expectTouchSized(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
}
