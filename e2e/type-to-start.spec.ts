import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { fakeForge, flushPendingSaves, openNotes } from "./helpers";
import { closeSettings, openSettings } from "./helpers/settings";
import { openWelcome, treeItem } from "./helpers/tree";

const AUTO_NAME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function nameField(page: Page) {
  return page.getByRole("textbox", { name: "Note name" });
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Note editor" });
}

function placeholder(page: Page) {
  return page.getByText("Select a note to read it, or");
}

async function treeItemNames(page: Page): Promise<string[]> {
  return page.getByRole("treeitem").allTextContents();
}

async function focusBody(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  await expect(page.locator("body")).toBeFocused();
}

async function expectNoDraft(page: Page, before: string[]): Promise<void> {
  await expect(nameField(page)).toHaveCount(0);
  await expect(placeholder(page)).toBeVisible();
  expect(await treeItemNames(page)).toEqual(before);
}

test.describe("on the empty note pane", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
    await expect(placeholder(page)).toBeVisible();
  });

  test("typing creates a note with an automatic name holding the typed text", async ({
    page,
  }) => {
    await focusBody(page);

    await page.keyboard.type("Hello world");

    await expect(nameField(page)).toHaveValue(AUTO_NAME);
    await expect(editor(page)).toHaveText("Hello world");
    await expect(editor(page)).toBeFocused();
    await expect(nameField(page)).not.toBeFocused();
    const created = treeItem(page, AUTO_NAME);
    await expect(created).toBeVisible();
    await expect(created).toHaveAttribute("aria-selected", "true");

    await page.goBack();
    await expect(placeholder(page)).toBeVisible();
    await expect(nameField(page)).toHaveCount(0);
    await expect(created).toBeVisible();
  });

  test("fast typing keeps every character in order", async ({ page }) => {
    await focusBody(page);

    await page.keyboard.type("abcdefghij");

    await expect(nameField(page)).toHaveValue(AUTO_NAME);
    await expect(editor(page)).toHaveText("abcdefghij");
  });

  test("typing after clicking the placeholder text starts a note", async ({
    page,
  }) => {
    await page.locator(".note-placeholder").click({ position: { x: 24, y: 4 } });

    await page.keyboard.type("Clicked");

    await expect(nameField(page)).toHaveValue(AUTO_NAME);
    await expect(editor(page)).toHaveText("Clicked");
  });

  test("typing while the search palette is open starts nothing", async ({
    page,
  }) => {
    const before = await treeItemNames(page);
    await page.getByRole("button", { name: "Search notes" }).click();
    const palette = page.getByRole("dialog", { name: "Search notes" });
    await expect(palette).toBeVisible();

    await page.keyboard.type("road");

    await expect(
      palette.getByRole("combobox", { name: "Search notes" }),
    ).toHaveValue("road");
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expectNoDraft(page, before);
  });

  test("typing while the Settings Panel is open starts nothing", async ({
    page,
  }) => {
    const before = await treeItemNames(page);
    await openSettings(page);

    await page.keyboard.type("x");

    await expect(nameField(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expectNoDraft(page, before);
  });

  test("turning the setting off stops typing from starting a note, turning it on restores it", async ({
    page,
  }) => {
    const before = await treeItemNames(page);
    const commitsBefore = await fakeForge(page).commitCount();
    const settings = await openSettings(page);
    const checkbox = settings.getByRole("checkbox", {
      name: "Start a note by typing",
    });
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await closeSettings(page);
    await flushPendingSaves(page);
    expect(await fakeForge(page).commitCount()).toBe(commitsBefore);
    await focusBody(page);
    await page.keyboard.type("x");
    await expectNoDraft(page, before);

    await openSettings(page);
    await checkbox.check();
    await closeSettings(page);
    await focusBody(page);
    await page.keyboard.type("Back");

    await expect(nameField(page)).toHaveValue(AUTO_NAME);
    await expect(editor(page)).toHaveText("Back");
  });

  test("typing while a menu is open starts nothing", async ({ page }) => {
    const before = await treeItemNames(page);
    await page.getByRole("button", { name: "More commands" }).click();
    const menu = page.getByRole("menu", { name: "Commands" });
    await expect(menu).toBeVisible();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });

    await page.keyboard.type("x");

    await expect(nameField(page)).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoDraft(page, before);
  });

  test("typing on a focused tree row starts nothing", async ({ page }) => {
    const before = await treeItemNames(page);
    await treeItem(page, "Welcome").focus();

    await page.keyboard.type("x");

    await expectNoDraft(page, before);
  });

  test("shortcuts with Control or Alt start nothing", async ({ page }) => {
    const before = await treeItemNames(page);
    await focusBody(page);

    await page.keyboard.press("Control+a");
    await page.keyboard.press("Alt+a");

    await expectNoDraft(page, before);
  });
});

test.describe("with a note open", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
  });

  test("typing on the page starts nothing", async ({ page }) => {
    const before = await treeItemNames(page);
    await focusBody(page);

    await page.keyboard.type("x");

    await expect(nameField(page)).toHaveValue("Welcome");
    await expect(editor(page)).not.toContainText(/^x/);
    expect(await treeItemNames(page)).toEqual(before);
  });

  test("typing in the name field edits the name as usual", async ({ page }) => {
    const before = await treeItemNames(page);
    await nameField(page).focus();
    await nameField(page).press("End");

    await page.keyboard.type("x");

    await expect(nameField(page)).toHaveValue("Welcomex");
    await expect(nameField(page)).toBeFocused();
    expect(await treeItemNames(page)).toEqual(before);
  });
});

test(
  "typing starts a note only where the note pane is shown",
  { tag: "@mobile" },
  async ({ page }, testInfo) => {
    await openNotes(page);
    const before = await treeItemNames(page);
    await focusBody(page);

    await page.keyboard.type("Hi");

    if (testInfo.project.name === "desktop") {
      await expect(nameField(page)).toHaveValue(AUTO_NAME);
      await expect(editor(page)).toHaveText("Hi");
    } else {
      await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
      await expect(nameField(page)).toHaveCount(0);
      expect(await treeItemNames(page)).toEqual(before);
    }
  },
);
