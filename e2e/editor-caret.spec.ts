import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  SAMPLE,
  chooseRepository,
  expectSettingsIdle,
  expectTree,
  flushPendingSaves,
  logOut,
  openNotes,
} from "./helpers";
import { closeSettings, openSettings } from "./helpers/settings";
import { CARET_BLINK_MS, CARET_HOLD_MS } from "../src/editor/caret-style";

const caretLayer = (page: Page) => page.locator(".cm-accent-caret-layer");
const tintLayer = (page: Page) => page.locator(".cm-caret-tint-layer");
const caret = (page: Page) => page.locator(".cm-accent-caret");
const tint = (page: Page) => page.locator(".cm-caret-tint");
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });

async function newNote(page: Page): Promise<void> {
  await openNotes(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await expect(editor(page)).toBeFocused();
}

async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
}

async function expectLight(page: Page, light: string): Promise<void> {
  await expect(caretLayer(page)).toHaveAttribute("data-caret", light);
  await expect(tintLayer(page)).toHaveAttribute("data-caret", light);
}

test("typing tints the letters before a 2px caret that blinks after a hold", async ({
  page,
}) => {
  await page.clock.install();
  await newNote(page);

  await page.keyboard.type("keeps typing");
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).not.toHaveCount(0);
  expect((await caret(page).boundingBox())!.width).toBe(2);
  await expect(editor(page)).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");

  await pauseClock(page);
  await page.keyboard.type("s");
  await expectLight(page, "solid");
  await page.clock.runFor(CARET_HOLD_MS - 1);
  await expectLight(page, "solid");
  await page.clock.runFor(1);
  await expectLight(page, "off");
  await page.clock.runFor(CARET_BLINK_MS);
  await expectLight(page, "on");
  await page.clock.runFor(CARET_BLINK_MS);
  await expectLight(page, "off");

  await page.keyboard.type("s");
  await expectLight(page, "solid");
});

async function expectTintEndsAtCaret(page: Page): Promise<void> {
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).toHaveCount(3);
  const caretBox = (await caret(page).boundingBox())!;
  const tintBox = (await tint(page).last().boundingBox())!;
  expect(
    Math.abs(tintBox.x + tintBox.width - (caretBox.x + caretBox.width / 2)),
  ).toBeLessThan(1.5);
  await expect(tintLayer(page)).toHaveAttribute(
    "data-caret",
    (await caretLayer(page).getAttribute("data-caret"))!,
  );
}

test("the tint follows the caret when it is moved with the arrow keys", async ({
  page,
}) => {
  await newNote(page);
  await page.keyboard.type("hello world");
  await expect(tint(page)).not.toHaveCount(0);

  await page.keyboard.press("ArrowLeft");
  await expectTintEndsAtCaret(page);

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).toHaveCount(0);
});

test("clicking into the middle of a word tints the letters before the caret", async ({
  page,
}) => {
  await openNotes(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await page.keyboard.type("remarkable words");
  await editor(page).blur();
  await expect(caret(page)).toHaveCount(0);

  const point = await page
    .locator(".cm-line")
    .last()
    .evaluate((line) => {
      const text = line.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, "remark".length);
      range.setEnd(text, "remark".length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    });
  await page.mouse.click(point.x, point.y);

  await expect(editor(page)).toBeFocused();
  await expectTintEndsAtCaret(page);
});

test("nothing is drawn without focus or with a selection", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("hello world");
  await expect(tint(page)).not.toHaveCount(0);

  await page.keyboard.press("Shift+ArrowLeft");
  await expect(caret(page)).toHaveCount(0);
  await expect(tint(page)).toHaveCount(0);

  await page.keyboard.press("End");
  await page.keyboard.type("s");
  await expect(tint(page)).not.toHaveCount(0);
  await editor(page).blur();
  await expect(caret(page)).toHaveCount(0);
  await expect(tint(page)).toHaveCount(0);
});

test("whitespace counts towards the three tinted positions", async ({
  page,
}) => {
  await newNote(page);
  const tinted = () =>
    page
      .locator(".cm-caret-tint")
      .evaluateAll((pieces) =>
        pieces.filter((piece) => piece.getBoundingClientRect().width > 0).length,
      );

  await page.keyboard.type("word ");
  await expect(caret(page)).toHaveCount(1);
  await expect.poll(tinted).toBe(3);

  await page.keyboard.type(" ");
  await expect.poll(tinted).toBe(2);

  await page.keyboard.type(" ");
  await expect(tint(page)).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.keyboard.type("word");
  await page.keyboard.insertText("\t");
  await expect.poll(tinted).toBe(3);
});

test("no tint at the start of a line", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("hello");
  await expect(tint(page)).not.toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).toHaveCount(0);
});

test("the caret stays solid with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await newNote(page);
  await page.keyboard.type("calm");
  await expect(tint(page)).not.toHaveCount(0);

  await pauseClock(page);
  await page.keyboard.type("s");
  await page.clock.runFor(CARET_HOLD_MS + 3 * CARET_BLINK_MS);
  await expectLight(page, "solid");
});

test("the browser caret takes over during IME composition", async ({
  page,
}) => {
  await newNote(page);
  await page.keyboard.type("Compose");
  await expect(caret(page)).toHaveCount(1);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "ñ",
    selectionStart: 1,
    selectionEnd: 1,
  });
  await expect(caret(page)).toHaveCount(0);
  await expect(tint(page)).toHaveCount(0);
  await expect(editor(page)).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");

  await cdp.send("Input.insertText", { text: "ñ" });
  await expect(editor(page)).toContainText("Composeñ");
  await expect(caret(page)).toHaveCount(1);
  await expect(editor(page)).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
});

test("the tint never moves or reshapes the letters", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("Wavy AVATAR office fluff Tyrvwy fi fl ff");
  await expect(tint(page)).not.toHaveCount(0);

  const line = page.locator(".cm-line").last();
  const glyphs = () =>
    line.evaluate((element) => {
      const positions: number[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < (node as Text).length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          positions.push(range.getBoundingClientRect().left);
        }
      }
      return { html: element.innerHTML, positions };
    });
  const tinted = await glyphs();

  await editor(page).blur();
  await expect(tint(page)).toHaveCount(0);

  expect(await glyphs()).toEqual(tinted);
});

test("the animated caret can be turned off and stays off after logging in again", async ({
  page,
}) => {
  const animatedCaret = () =>
    page.getByRole("checkbox", { name: "Animated caret" });
  await newNote(page);
  await page.keyboard.type("hello");
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).not.toHaveCount(0);

  await openSettings(page);
  await expect(animatedCaret()).toBeChecked();
  await animatedCaret().uncheck();
  await flushPendingSaves(page);
  await expectSettingsIdle(page);
  await closeSettings(page);

  await editor(page).click();
  await page.keyboard.type("s");
  await expect(caretLayer(page)).toHaveCount(0);
  await expect(tint(page)).toHaveCount(0);
  await expect(editor(page)).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");

  await openSettings(page);
  await animatedCaret().check();
  await closeSettings(page);
  await editor(page).click();
  await page.keyboard.type("s");
  await expect(caret(page)).toHaveCount(1);
  await expect(editor(page)).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");

  await openSettings(page);
  await animatedCaret().uncheck();
  await flushPendingSaves(page);
  await expectSettingsIdle(page);
  await closeSettings(page);

  await logOut(page);
  await chooseRepository(page, { repo: SAMPLE.repo });
  await page.getByLabel("Passphrase", { exact: true }).fill(SAMPLE.passphrase);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await editor(page).click();
  await expect(editor(page)).toBeFocused();
  await expect(caretLayer(page)).toHaveCount(0);

  await openSettings(page);
  await expect(animatedCaret()).not.toBeChecked();
});

test("emoji in the tail are tinted like letters, one position each", async ({
  page,
}) => {
  await newNote(page);
  await page.keyboard.type("Coding ");
  await page.keyboard.insertText("👩‍💻");

  const emoji = page.locator(".cm-caret-tint-emoji");
  await expect(emoji).toHaveCount(1);
  await expect(emoji).toHaveText("👩‍💻");
  await expect(tint(page)).toHaveCount(2);

  const glyph = await page
    .locator(".cm-line")
    .last()
    .evaluate((line) => {
      const text = line.firstChild as Text;
      const range = document.createRange();
      range.setStart(text, "Coding ".length);
      range.setEnd(text, text.length);
      return range.getBoundingClientRect().left;
    });
  expect(Math.abs((await emoji.boundingBox())!.x - glyph)).toBeLessThan(0.5);

  await page.keyboard.press("Enter");
  await page.keyboard.type("ok");
  await page.keyboard.insertText("🇵🇱🇵🇱");
  await expect(emoji).toHaveCount(2);
  await expect(tint(page)).toHaveCount(3);
});
