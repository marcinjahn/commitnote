import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { expectInputKind } from "./helpers/input-kind";
import { enableVimMode } from "./helpers/settings";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });
const modeText = (page: Page) => page.locator(".vim-status-bar .mode-label");

async function startNewNote(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await expect(editor(page)).toBeFocused();
}

async function expectLines(page: Page, lines: string[]): Promise<void> {
  await expect
    .poll(() => editor(page).locator(".cm-line").allTextContents())
    .toEqual(lines);
}

// The replacement range is in offsets of the focused editable's text, which
// match document offsets on the first line.
async function replaceByComposition(
  page: Page,
  range: { from: number; to: number },
  text: string,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
    replacementStart: range.from,
    replacementEnd: range.to,
  });
  await cdp.send("Input.insertText", { text });
  await cdp.detach();
}

async function replaceInDom(
  page: Page,
  word: string,
  replacement: string,
): Promise<void> {
  await editor(page).evaluate(
    (content, [word, replacement]) => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        const at = text.data.indexOf(word);
        if (at >= 0) {
          text.replaceData(at, word.length, replacement);
          return;
        }
      }
      throw new Error(`"${word}" is not in the editor`);
    },
    [word, replacement] as const,
  );
}

function headingFontSizeRatio(page: Page, word: string): Promise<number> {
  return editor(page).evaluate((content, word) => {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Text).data.includes(word))
        return (
          parseFloat(getComputedStyle(node.parentElement!).fontSize) /
          parseFloat(getComputedStyle(content).fontSize)
        );
    }
    return 0;
  }, word);
}

test("a composition replacing a whole word edits the note once @mobile", async ({
  page,
}) => {
  await openNotes(page);
  await startNewNote(page);
  await page.keyboard.type("Helo wrld");
  // Putting the caret into the word ends the typing's undo step, as tapping
  // a word for its suggestions does.
  await page.keyboard.press("ArrowLeft");
  await expectInputKind(editor(page), "prose");

  await replaceByComposition(page, { from: 5, to: 9 }, "world");
  await expectLines(page, ["Helo world"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expectLines(page, ["Helo wrld"]);

  await replaceByComposition(page, { from: 5, to: 9 }, "world");
  await expectLines(page, ["Helo world"]);
  await page.keyboard.type("!");
  await expectLines(page, ["Helo world!"]);
  await page.keyboard.press("Backspace");
  await expectLines(page, ["Helo world"]);
});

test("a composition replacing a word in a list item keeps list continuation @mobile", async ({
  page,
}) => {
  await openNotes(page);
  await startNewNote(page);
  await page.keyboard.type("- frst item");

  await replaceByComposition(page, { from: 2, to: 6 }, "first");
  await expectLines(page, ["- first item"]);

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expectLines(page, ["- first item", "- "]);
});

test("a DOM text change replacing a word in a heading keeps the heading", async ({
  page,
}) => {
  await openNotes(page);
  await startNewNote(page);
  await page.keyboard.type("# Helo there");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => headingFontSizeRatio(page, "Helo"))
    .toBeGreaterThan(1);

  await replaceInDom(page, "Helo", "Hello");

  await expectLines(page, ["# Hello there"]);
  await expect
    .poll(() => headingFontSizeRatio(page, "Hello"))
    .toBeGreaterThan(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expectLines(page, ["# Helo there"]);
});

test("a DOM text change replacing a word in Vim insert mode keeps the editing mode", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await startNewNote(page);
  await page.keyboard.press("Escape");
  await expect(modeText(page)).toHaveText("NORMAL");
  await page.keyboard.press("i");
  await expect(modeText(page)).toHaveText("INSERT");
  await page.keyboard.type("Helo there");

  await replaceInDom(page, "Helo", "Hello");

  await expectLines(page, ["Hello there"]);
  await expect(modeText(page)).toHaveText("INSERT");
  await page.keyboard.press("Escape");
  await expect(modeText(page)).toHaveText("NORMAL");
  await page.keyboard.press("x");
  await expectLines(page, ["Hello ther"]);
});
