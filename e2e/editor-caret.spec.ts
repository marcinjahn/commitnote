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
import {
  closeSettings,
  enableVimMode,
  openSettings,
} from "./helpers/settings";
import { openWelcome } from "./helpers/tree";
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

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

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
});

async function expectTintEndsAtCaret(page: Page): Promise<void> {
  await expect(caret(page)).toHaveCount(1);
  await expect(tint(page)).toHaveCount(3);
  const caretBox = (await caret(page).boundingBox())!;
  const tintBox = (await tint(page).last().boundingBox())!;
  expect(
    Math.abs(tintBox.x + tintBox.width - (caretBox.x + caretBox.width / 2)),
  ).toBeLessThan(1.5);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const caretState = document
          .querySelector(".cm-accent-caret-layer")
          ?.getAttribute("data-caret");
        const tintState = document
          .querySelector(".cm-caret-tint-layer")
          ?.getAttribute("data-caret");
        return caretState != null && caretState === tintState
          ? "in sync"
          : `caret ${caretState}, tint ${tintState}`;
      }),
    )
    .toBe("in sync");
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

test("forced colours hide the drawn caret and restore the browser caret", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await newNote(page);
  await page.keyboard.type("contrast");

  await expect(caretLayer(page)).toBeHidden();
  await expect(tintLayer(page)).toBeHidden();
  await expect(editor(page)).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
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

test.describe("vim mode", () => {
  const fatCursor = (page: Page) => page.locator(".cm-fat-cursor:visible");
  const thinCursor = (page: Page) => page.locator(".cm-cursor:visible");
  const mode = (page: Page) => page.locator(".vim-status-bar .mode-label");

  const tokenColour = (page: Page, token: string) =>
    page.evaluate((name) => {
      const probe = document.createElement("div");
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, token);

  const cursorStyle = (page: Page) =>
    fatCursor(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
        opacity: style.opacity,
        visibility: style.visibility,
      };
    });

  async function openVimNote(page: Page): Promise<void> {
    await openNotes(page);
    await enableVimMode(page);
    await openWelcome(page);
    await editor(page).focus();
    await expect(editor(page)).toBeFocused();
    await expect(mode(page)).toHaveText("NORMAL");
  }

  async function expectNoDrawnCaret(page: Page): Promise<void> {
    await expect(caret(page)).toHaveCount(0);
    await expect(tint(page)).toHaveCount(0);
    await expect(page.locator(".cm-content")).not.toHaveClass(/cm-own-caret/);
  }

  test("normal and replace show a steady accent block instead of the drawn caret", async ({
    page,
  }) => {
    await page.clock.install();
    await openVimNote(page);

    await expect(fatCursor(page)).toHaveCount(1);
    await expectNoDrawnCaret(page);
    await expect(thinCursor(page)).toHaveCount(0);

    const accent = await tokenColour(page, "--color-accent");
    const onAccent = await tokenColour(page, "--color-on-accent");
    await expect
      .poll(async () => {
        const { background, color } = await cursorStyle(page);
        return { background, color };
      })
      .toEqual({ background: accent, color: onAccent });
    const normal = await cursorStyle(page);

    await pauseClock(page);
    await page.clock.runFor(CARET_BLINK_MS * 2);
    expect(await cursorStyle(page)).toEqual(normal);

    const normalBox = (await fatCursor(page).boundingBox())!;
    const normalHeight = normalBox.height;
    await page.keyboard.press("Shift+R");
    await expect(mode(page)).toHaveText("REPLACE");
    await expect(fatCursor(page)).toHaveCount(1);
    await expectNoDrawnCaret(page);
    await expect(thinCursor(page)).toHaveCount(0);
    await page.clock.runFor(CARET_BLINK_MS);
    await expect
      .poll(async () => (await fatCursor(page).boundingBox())!.height)
      .toBeCloseTo(normalHeight, 0);
    await expect
      .poll(async () => (await fatCursor(page).boundingBox())!.y)
      .toBeCloseTo(normalBox.y, 0);
    const replace = await cursorStyle(page);
    expect(replace.background).toBe(accent);
    expect(replace.color).toBe(onAccent);
    await page.clock.runFor(CARET_BLINK_MS * 2);
    expect(await cursorStyle(page)).toEqual(replace);
  });

  test("the block becomes a hollow accent outline without focus", async ({
    page,
  }) => {
    await openVimNote(page);
    await editor(page).blur();

    await expect(fatCursor(page)).toHaveCount(1);
    const accent = await tokenColour(page, "--color-accent");
    await expect
      .poll(async () => {
        const { background, outline } = await cursorStyle(page);
        return { background, outline };
      })
      .toEqual({
        background: "rgba(0, 0, 0, 0)",
        outline: `1px solid ${accent}`,
      });
    await expectNoDrawnCaret(page);
  });

  test("insert keeps the animated accent caret and hides the block", async ({
    page,
  }) => {
    await openVimNote(page);
    await page.keyboard.press("i");
    await expect(mode(page)).toHaveText("INSERT");

    await expect(caret(page)).toHaveCount(1);
    expect((await caret(page).boundingBox())!.width).toBe(2);
    await expect(page.locator(".cm-content")).toHaveClass(/cm-own-caret/);
    await expect(fatCursor(page)).toHaveCount(0);
    await expect(thinCursor(page)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(mode(page)).toHaveText("NORMAL");
    await expect(fatCursor(page)).toHaveCount(1);
    await expect(caret(page)).toHaveCount(0);
  });

  test("insert with the animated caret off shows one thin cursor", async ({
    page,
  }) => {
    await openNotes(page);
    await enableVimMode(page);
    await openSettings(page);
    await page.getByRole("checkbox", { name: "Animated caret" }).uncheck();
    await flushPendingSaves(page);
    await expectSettingsIdle(page);
    await closeSettings(page);
    await openWelcome(page);
    await editor(page).focus();
    await expect(mode(page)).toHaveText("NORMAL");

    await page.keyboard.press("i");
    await expect(mode(page)).toHaveText("INSERT");
    await expect(thinCursor(page)).toHaveCount(1);
    expect((await thinCursor(page).boundingBox())!.width).toBe(2);
    await expect(caret(page)).toHaveCount(0);
    await expect(fatCursor(page)).toHaveCount(0);
  });

  test("visual shows the selection with the block at its head", async ({
    page,
  }) => {
    await openVimNote(page);
    await page.keyboard.press("0");
    await page.keyboard.press("v");
    await expect(mode(page)).toHaveText("VISUAL");
    await page.keyboard.type("lll");

    await expect(page.locator(".cm-selectionBackground:visible")).not.toHaveCount(
      0,
    );
    await expect(fatCursor(page)).toHaveCount(1);
    await expect(thinCursor(page)).toHaveCount(0);
    await expectNoDrawnCaret(page);

    const selection = (await page
      .locator(".cm-selectionBackground:visible")
      .first()
      .boundingBox())!;
    const block = (await fatCursor(page).boundingBox())!;
    expect(block.x).toBeGreaterThanOrEqual(selection.x);
    expect(block.x).toBeLessThanOrEqual(selection.x + selection.width);
  });

  test("visual selection stays inside the text column @mobile", async ({
    page,
  }) => {
    await openVimNote(page);
    await page.keyboard.type("ggjvje");
    await expect(mode(page)).toHaveText("VISUAL");
    await expect(page.locator(".cm-selectionBackground:visible")).not.toHaveCount(
      0,
    );

    const { textLeft, columnRight, edges } = await page.evaluate(() => {
      const content = document.querySelector(".cm-content")!;
      const line = content.querySelectorAll(".cm-line")[2]!;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let textLeft = Number.POSITIVE_INFINITY;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects())
          if (rect.width > 0) textLeft = Math.min(textLeft, rect.left);
      }
      const edges = [
        ...document.querySelectorAll(".cm-selectionBackground"),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      return {
        textLeft,
        columnRight: content.getBoundingClientRect().right,
        edges,
      };
    });

    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.left).toBeGreaterThanOrEqual(textLeft - 1);
      expect(edge.right).toBeLessThanOrEqual(columnRight + 1);
    }
  });
});
