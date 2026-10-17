import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { expectSettingsIdle, flushPendingSaves, openNotes } from "./helpers";
import {
  closeSettings,
  enableVimMode,
  openSettings,
} from "./helpers/settings";
import { openWelcome, treeItem } from "./helpers/tree";

const DEFAULT_DESCRIPTION =
  "Press Escape, then Tab, to leave the editor.";
const VIM_DESCRIPTION =
  "Vim mode is on. Press Escape, then Tab, to leave the editor.";
const LINK_URL = "https://github.com/example/commitnote";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });
const bar = (page: Page) => page.locator(".vim-status-bar");
const modeText = (page: Page) => bar(page).locator(".mode-label");
const position = (page: Page) => bar(page).locator(".position");
const gutter = (page: Page) => page.locator(".cm-relative-line-numbers");
const commandInput = (page: Page, name = "Vim command") =>
  page.getByRole("textbox", { name });
const saveToast = (page: Page) =>
  page
    .locator('[role="group"][aria-label="Info"]:not([inert])')
    .filter({ hasText: "All saved" });

async function openVimWelcome(page: Page): Promise<void> {
  await openNotes(page);
  await enableVimMode(page);
  await openWelcome(page);
  await expect(modeText(page)).toHaveText("NORMAL");
}

async function focusEditor(page: Page): Promise<void> {
  await editor(page).focus();
  await expect(editor(page)).toBeFocused();
}

async function startNewNote(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await expect(editor(page)).toBeFocused();
}


test("vim mode is off by default and loads nothing", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await openNotes(page);
  await openWelcome(page);

  await expect(bar(page)).toHaveCount(0);
  await expect(gutter(page)).toHaveCount(0);
  await expect(editor(page)).toHaveAccessibleDescription(DEFAULT_DESCRIPTION);
  expect(requested.filter((url) => url.includes("vim-extension"))).toEqual([]);
});

test("toggling the setting applies live to the open note", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await expect(bar(page)).toHaveCount(0);

  const dialog = await openSettings(page);
  await dialog.getByRole("checkbox", { name: "Vim mode" }).check();
  await flushPendingSaves(page);
  await expectSettingsIdle(page);
  await closeSettings(page);

  await expect(modeText(page)).toHaveText("NORMAL");
  await expect(gutter(page)).toBeVisible();
  await expect(editor(page)).toHaveAccessibleDescription(VIM_DESCRIPTION);

  const again = await openSettings(page);
  await again.getByRole("checkbox", { name: "Vim mode" }).uncheck();
  await flushPendingSaves(page);
  await expectSettingsIdle(page);
  await closeSettings(page);

  await expect(bar(page)).toHaveCount(0);
  await expect(gutter(page)).toHaveCount(0);
  await expect(editor(page)).toHaveAccessibleDescription(DEFAULT_DESCRIPTION);
});

test("editing modes follow the keys and the bar follows the modes", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await startNewNote(page);
  await expect(modeText(page)).toHaveText("INSERT");
  await expect(
    bar(page).getByRole("button", { name: "Mode: Insert. Switch to Normal mode" }),
  ).toBeVisible();

  await page.keyboard.type("abc");
  await page.keyboard.press("Enter");
  await page.keyboard.type("def");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ghi");
  await expect(position(page)).toHaveText("3:4");
  await page.keyboard.press("Escape");
  await expect(modeText(page)).toHaveText("NORMAL");
  await expect(bar(page).getByRole("status")).toHaveText("Normal mode");
  await expect(position(page)).toHaveText("3:3");

  await page.keyboard.press("x");
  await expect(editor(page)).toHaveText("abcdefgh");
  await page.keyboard.type("dd");
  await expect(editor(page)).toHaveText("abcdef");
  await page.keyboard.press("u");
  await expect(editor(page)).toHaveText("abcdefgh");

  await page.keyboard.type("gg");
  await expect(position(page)).toHaveText("1:1");
  await page.keyboard.type("vl");
  await expect(modeText(page)).toHaveText("VISUAL");
  await page.keyboard.press("d");
  await expect(modeText(page)).toHaveText("NORMAL");
  await expect(editor(page)).toHaveText("cdefgh");

  await page.keyboard.press("Shift+V");
  await expect(modeText(page)).toHaveText("V-LINE");
  await page.keyboard.press("Escape");
  await expect(modeText(page)).toHaveText("NORMAL");

  await page.keyboard.press("2");
  await page.keyboard.press("d");
  await expect(bar(page)).toContainText("2d");
  await page.keyboard.press("Escape");
  await expect(bar(page)).not.toContainText("2d");

  await bar(page).getByRole("button", { name: /^Mode: Normal/ }).click();
  await expect(modeText(page)).toHaveText("INSERT");
  await bar(page).getByRole("button", { name: /^Mode: Insert/ }).click();
  await expect(modeText(page)).toHaveText("NORMAL");
});

test("the command line runs ex commands and keeps history", async ({
  page,
}) => {
  await openVimWelcome(page);
  await focusEditor(page);

  await page.keyboard.press(":");
  await expect(commandInput(page)).toBeFocused();
  await page.keyboard.type("w");
  await page.keyboard.press("Enter");
  await expect(saveToast(page)).toBeVisible();

  await page.keyboard.press(":");
  await page.keyboard.type("e");
  await page.keyboard.press("Enter");
  await expect(bar(page)).toContainText('Not an editor command ":e"');
  await expect(bar(page).getByRole("status")).toHaveText(
    'Not an editor command ":e"',
  );

  await page.keyboard.press(":");
  await page.keyboard.press("ArrowUp");
  await expect(commandInput(page)).toHaveValue("e");
  await page.keyboard.press("Escape");
  await expect(commandInput(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  await page.keyboard.press(":");
  await page.keyboard.type("q");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Select a note to read it, or")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);

  await openWelcome(page);
  await expect(modeText(page)).toHaveText("NORMAL");
  await focusEditor(page);
  await page.keyboard.press("i");
  await page.keyboard.type("Edited ");
  await page.keyboard.press("Escape");
  await page.keyboard.press(":");
  await page.keyboard.type("wq");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Select a note to read it, or")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);

  await openWelcome(page);
  await expect(editor(page)).toContainText("Edited # Welcome");
});

test("yank and put go through the system clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const readClipboard = () =>
    page.evaluate(() => navigator.clipboard.readText());
  const lines = editor(page).locator(".cm-line");
  await openNotes(page);
  await enableVimMode(page);
  await startNewNote(page);
  await page.keyboard.type("alpha beta");
  await page.keyboard.press("Escape");

  await page.keyboard.type("0yw");
  await expect.poll(readClipboard).toBe("alpha ");

  await page.evaluate(() => navigator.clipboard.writeText("gamma "));
  await page.keyboard.press("Shift+P");
  await expect(lines).toHaveText(["alpha alpha beta"]);
  await page.keyboard.press("u");

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.press("Shift+P");
  await expect(lines).toHaveText(["gamma alpha beta"]);

  await page.keyboard.type("yyp");
  await expect(lines).toHaveText(["gamma alpha beta", "gamma alpha beta"]);
  await expect.poll(readClipboard).toBe("gamma alpha beta\n");
  await page.keyboard.press("u");
  await expect(lines).toHaveText(["gamma alpha beta"]);

  await page.evaluate(() => navigator.clipboard.writeText(" delta"));
  await page.keyboard.press("Shift+A");
  await expect(modeText(page)).toHaveText("INSERT");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(lines).toHaveText(["gamma alpha beta delta"]);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(readClipboard).toBe("delta");
  await expect(modeText(page)).toHaveText("INSERT");

  await page.keyboard.press("Escape");
  await page.keyboard.press("0");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+Shift+V",
  );
  await expect(lines).toHaveText(["gdeltaamma alpha beta delta"]);
  await expect(modeText(page)).toHaveText("NORMAL");
  await page.keyboard.press("u");
  await expect(lines).toHaveText(["gamma alpha beta delta"]);
});

test("search moves the cursor to the match and n repeats it", async ({
  page,
}) => {
  await openVimWelcome(page);
  await focusEditor(page);
  await expect(position(page)).toHaveText("1:1");

  await page.keyboard.press("/");
  await expect(commandInput(page, "Search forward")).toBeFocused();
  await page.keyboard.type("bullet");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await expect(position(page)).not.toHaveText("1:1");
  const first = await position(page).innerText();

  await page.keyboard.press("n");
  await expect(position(page)).not.toHaveText(first);
});

test("search matches use the themed highlight in light and dark", async ({
  page,
}) => {
  await openVimWelcome(page);
  await focusEditor(page);

  await page.keyboard.press("/");
  await expect(commandInput(page, "Search forward")).toBeFocused();
  await page.keyboard.type("bullet");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();

  const resolve = (token: string) =>
    page.evaluate((name) => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = name.startsWith("--")
        ? `var(${name})`
        : name;
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    }, token);
  const matchBackgrounds = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".cm-searchMatch")).map(
        (el) => getComputedStyle(el).backgroundColor,
      ),
    );

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const wash = await resolve("--color-vim-mode-wash");
    const selection = await resolve(
      "color-mix(in srgb, var(--color-accent) 22%, var(--color-background))",
    );
    expect(wash).not.toBe(selection);
    await expect
      .poll(async () => (await matchBackgrounds()).includes(wash))
      .toBe(true);
    expect(await matchBackgrounds()).not.toContain(selection);
  }
});

test("relative line numbers follow the cursor", async ({ page }) => {
  await openVimWelcome(page);
  await focusEditor(page);

  const current = page.locator(".cm-relative-line-current");
  await expect(current).toHaveText("1");
  await expect(gutter(page).getByText("1", { exact: true })).toHaveCount(2);

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(current).toHaveText("3");
  await expect(
    gutter(page).locator(".cm-gutterElement", { hasText: /^2$/ }),
  ).not.toHaveCount(0);

  await page.keyboard.press("k");
  await expect(current).toHaveText("2");
});

test("the current line number uses the text-safe accent", async ({ page }) => {
  await openVimWelcome(page);
  await focusEditor(page);
  const colorOf = (selector: string) =>
    page.locator(selector).first().evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-link)";
      element.append(probe);
      const colors = {
        own: getComputedStyle(element).color,
        link: getComputedStyle(probe).color,
      };
      probe.remove();
      return colors;
    });
  const current = ".cm-relative-line-current";
  const other =
    ".cm-relative-line-numbers .cm-gutterElement:not(.cm-relative-line-current):not([style*='visibility'])";
  const width = () =>
    gutter(page).evaluate((element) => element.getBoundingClientRect().width);

  const before = await width();
  const colors = await colorOf(current);
  expect(colors.own).toBe(colors.link);
  expect((await colorOf(other)).own).not.toBe(colors.own);

  await page.keyboard.press("j");
  await expect(page.locator(current)).toHaveText("2");
  expect(await width()).toBe(before);

  await page.emulateMedia({ forcedColors: "active" });
  await expect
    .poll(async () => (await colorOf(current)).own)
    .not.toBe((await colorOf(other)).own);
});

test("the position names the vim cursor in every visual mode", async ({
  page,
}) => {
  await openVimWelcome(page);
  await focusEditor(page);

  await page.keyboard.type("ggjvje");
  await expect(modeText(page)).toHaveText("VISUAL");
  await expect(position(page)).toHaveText("3:4");

  await page.keyboard.press("Escape");
  await expect(modeText(page)).toHaveText("NORMAL");
  await expect(position(page)).toHaveText("3:4");

  await page.keyboard.type("0V");
  await expect(modeText(page)).toHaveText("V-LINE");
  await expect(position(page)).toHaveText("3:1");
});

test("the visual position follows a shift-click", async ({ page }) => {
  await openVimWelcome(page);
  await focusEditor(page);

  await page.keyboard.type("gg");
  await page.keyboard.press("v");
  await expect(modeText(page)).toHaveText("VISUAL");

  const line = page.locator(".cm-line", { hasText: "This is your" });
  const box = await line.boundingBox();
  if (!box) throw new Error("the paragraph line has no box");
  await page.mouse.move(box.x + 48, box.y + 8);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(position(page)).toHaveText(/^3:([1-9]|1[0-2])$/);
  const column = Number((await position(page).innerText()).split(":")[1]);
  await expect(page.locator(".cm-fat-cursor")).toHaveText(
    "This is your"[column - 1] ?? "",
  );
  await expect(page.locator(".cm-relative-line-current")).toHaveText("3");
});

test("Escape then Tab leaves the editor from insert and visual, and Tab indents", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await startNewNote(page);
  await expect(modeText(page)).toHaveText("INSERT");

  await page.keyboard.type("word");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toHaveText(/^\s+word$/);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(editor(page)).not.toBeFocused();
  await expect(editor(page)).toHaveText(/^\s+word$/);

  await focusEditor(page);
  await page.keyboard.press("v");
  await expect(modeText(page)).toHaveText("VISUAL");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(editor(page)).not.toBeFocused();
  await expect(editor(page)).toHaveText(/^\s+word$/);
});

test("Mod+Enter on a link still opens it with vim mode on", async ({
  page,
  context,
}) => {
  await context.route(/^https:\/\/github\.com\/example\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>stub</title>",
    }),
  );
  await openVimWelcome(page);
  await page
    .locator(".cm-content .cm-link", { hasText: "commitnote project" })
    .click();
  await expect(editor(page)).toBeFocused();
  await expect(modeText(page)).toHaveText("NORMAL");

  const opened = context.waitForEvent("page");
  await page.keyboard.press("ControlOrMeta+Enter");
  await (await opened).waitForURL(LINK_URL);
});

test("Mod+S saves from normal mode", async ({ page }) => {
  await openVimWelcome(page);
  await focusEditor(page);

  await page.keyboard.press("ControlOrMeta+s");

  await expect(saveToast(page)).toBeVisible();
  await expect(modeText(page)).toHaveText("NORMAL");
});

test("typing on the empty pane starts a note in insert mode", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });

  await page.keyboard.type("Typed");

  await expect(editor(page)).toHaveText("Typed");
  await expect(modeText(page)).toHaveText("INSERT");
});

test("switching notes resets the mode to normal", async ({ page }) => {
  await openVimWelcome(page);
  await focusEditor(page);
  await page.keyboard.press("i");
  await expect(modeText(page)).toHaveText("INSERT");

  await treeItem(page, "Zażółć gęślą jaźń").click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Zażółć gęślą jaźń",
  );
  await expect(modeText(page)).toHaveText("NORMAL");
});

test("the bar and its buttons work on the narrow layout", { tag: "@mobile-only" }, async ({
  page,
}) => {
  await openVimWelcome(page);
  await expect(bar(page)).toBeVisible();

  await bar(page).getByRole("button", { name: /^Mode: Normal/ }).tap();
  await expect(modeText(page)).toHaveText("INSERT");
  await bar(page).getByRole("button", { name: /^Mode: Insert/ }).tap();
  await expect(modeText(page)).toHaveText("NORMAL");

  await bar(page).getByRole("button", { name: "Open command line" }).tap();
  await expect(commandInput(page)).toBeFocused();
});

test(
  "relative line numbers keep an inset from the screen edge on the narrow layout",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await openVimWelcome(page);
    await expect(gutter(page)).toBeVisible();

    const lefts = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".cm-relative-line-numbers .cm-gutterElement",
        ),
      )
        .filter((el) => el.textContent?.trim())
        .map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().left;
        }),
    );

    expect(lefts.length).toBeGreaterThan(0);
    for (const left of lefts) expect(left).toBeGreaterThanOrEqual(8);
  },
);

async function rowCentres(
  page: Page,
  lineText: string,
): Promise<{ number: number; text: number }> {
  return page.evaluate((needle) => {
    const lines = Array.from(document.querySelectorAll(".cm-content .cm-line"));
    const index = lines.findIndex((line) =>
      line.textContent?.includes(needle),
    );
    const numbers = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".cm-relative-line-numbers .cm-gutterElement",
      ),
    ).filter((el) => el.style.visibility !== "hidden");
    const firstRect = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getClientRects()[0];
        if (rect) return rect;
      }
      throw new Error(`no text rect for ${needle}`);
    };
    const number = firstRect(numbers[index]);
    const text = firstRect(lines[index]);
    return {
      number: number.top + number.height / 2,
      text: text.top + text.height / 2,
    };
  }, lineText);
}

test(
  "relative line numbers align with the first row of their line",
  { tag: "@mobile" },
  async ({ page }) => {
    await openVimWelcome(page);

    for (const lineText of [
      "Welcome",
      "This is your",
      "Done task",
      "Open task",
      "console.log",
      "```js",
    ]) {
      await expect
        .poll(async () => {
          const centres = await rowCentres(page, lineText);
          return Math.abs(centres.number - centres.text);
        }, { message: lineText })
        .toBeLessThanOrEqual(2);
    }
  },
);
