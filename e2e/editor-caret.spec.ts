import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
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

test("the tint goes away when the caret moves without typing, the caret stays", async ({
  page,
}) => {
  await newNote(page);
  await page.keyboard.type("hello world");
  await expect(tint(page)).not.toHaveCount(0);

  await page.keyboard.press("ArrowLeft");
  await expect(tint(page)).toHaveCount(0);
  await expect(caret(page)).toHaveCount(1);

  await page.keyboard.press("End");
  await page.keyboard.type("s");
  await expect(tint(page)).not.toHaveCount(0);
  await editor(page).click({ position: { x: 5, y: 5 } });
  await expect(tint(page)).toHaveCount(0);
  await expect(caret(page)).toHaveCount(1);
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

test("no tint at the start of a line or after a space", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("hello ");
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).toHaveCount(0);

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

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(tint(page)).toHaveCount(0);

  expect(await glyphs()).toEqual(tinted);
});
