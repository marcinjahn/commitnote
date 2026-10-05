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
  treeItem,
  waitForSynced,
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
  return treeItem(page, name).locator("svg.row-icon");
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

  await page.getByRole("button", { name: `Actions for ${PURPLE_NOTE}` }).click();
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

test("a tagged note keeps its tag through trash and restore", async ({ page }) => {
  await moveToTrash(page, PURPLE_NOTE);
  await expect(treeItem(page, PURPLE_NOTE)).toHaveCount(0);

  const dialog = await openTrash(page);
  await dialog
    .getByRole("button", { name: `Restore ${PURPLE_NOTE} to…`, exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: /^Restore .* to folder$/ });
  await picker.getByRole("radio", { name: "Notes (top level)", exact: true }).check();
  await picker.getByRole("button", { name: "Restore", exact: true }).click();

  await expectTagged(page, PURPLE_NOTE, "Purple");
});

test("the color picker is operable from the keyboard", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Actions for Welcome" });
  const menu = rowMenu(page, "Welcome");

  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(swatch(menu, "No color")).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(swatch(menu, "Purple")).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expectTagged(page, "Welcome", "Purple");

  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(swatch(menu, "Purple")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
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
