import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";

const LINK_URL = "https://github.com/example/commitnote";

declare global {
  interface Window {
    __opened: string[];
  }
}

function openedUrls(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => window.__opened);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.__opened = [];
    const open = window.open.bind(window);
    window.open = (...args) => {
      window.__opened.push(String(args[0]));
      return open(...args);
    };
  });
  await context.route(/^https:\/\/(github\.com\/example|www\.example\.org)\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>stub</title>",
    }),
  );
});

async function openWelcomeLink(page: import("@playwright/test").Page) {
  await openNotes(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toBeVisible();
  const link = page.locator(".cm-content .cm-link", {
    hasText: "commitnote project",
  });
  await expect(link).toBeVisible();
  return { editor, link };
}

test("Ctrl+click on a link opens it in a new tab without editing the note", async ({
  page,
  context,
}) => {
  const { editor, link } = await openWelcomeLink(page);

  const pagePromise = context.waitForEvent("page");
  await link.click({ modifiers: ["Control"] });
  const newPage = await pagePromise;
  await newPage.waitForURL(LINK_URL);

  await expect(editor).toContainText("See the commitnote project for details.");
  await expect(link).toBeVisible();
});

test("plain click on a link does not open a new tab", async ({
  page,
  context,
}) => {
  const { link } = await openWelcomeLink(page);

  const pageCount = context.pages().length;
  await link.click();

  expect(context.pages().length).toBe(pageCount);
  expect(await openedUrls(page)).toEqual([]);
});

test("Cmd+click on a link opens it in a new tab", async ({ page, context }) => {
  const { link } = await openWelcomeLink(page);

  const pagePromise = context.waitForEvent("page");
  await link.click({ modifiers: ["Meta"] });
  const newPage = await pagePromise;
  await newPage.waitForURL(LINK_URL);
});

test("holding Control shows a pointer cursor over a link", async ({ page }) => {
  const { link } = await openWelcomeLink(page);
  await link.hover();
  await expect(link).not.toHaveCSS("cursor", "pointer");

  await page.keyboard.down("Control");
  await link.hover({ position: { x: 2, y: 2 } });
  await expect(link).toHaveCSS("cursor", "pointer");
  await page.keyboard.up("Control");
});

test("Ctrl+click on text outside a link does not open a new tab", async ({
  page,
  context,
}) => {
  await openWelcomeLink(page);
  const text = page.locator(".cm-content .cm-line", {
    hasText: "Notes stay private",
  });

  const pageCount = context.pages().length;
  await text.click({ modifiers: ["Control"] });

  expect(context.pages().length).toBe(pageCount);
  expect(await openedUrls(page)).toEqual([]);
});

test("Ctrl+click in the blank space right of a line ending in a link does not open a new tab", async ({
  page,
  context,
}) => {
  const { editor } = await openWelcomeLink(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(
    "\n[trailing link](https://github.com/example/trailing)",
  );
  await page
    .locator(".cm-content .cm-line", { hasText: "Notes stay private" })
    .click();
  const link = page.locator(".cm-content .cm-link", {
    hasText: "trailing link",
  });
  await expect(link).toHaveText("trailing link");
  const box = await link.boundingBox();
  if (!box) throw new Error("link has no bounding box");
  const editorBox = await editor.boundingBox();
  if (!editorBox) throw new Error("editor has no bounding box");

  const pageCount = context.pages().length;
  await page.keyboard.down("Control");
  await page.mouse.click(
    editorBox.x + editorBox.width - 20,
    box.y + box.height / 2,
  );
  await page.keyboard.up("Control");

  expect(context.pages().length).toBe(pageCount);
  expect(await openedUrls(page)).toEqual([]);
});

async function typeLine(
  page: import("@playwright/test").Page,
  editor: import("@playwright/test").Locator,
  text: string,
) {
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(`\n${text}`);
  await page
    .locator(".cm-content .cm-line", { hasText: "Notes stay private" })
    .click();
}

function textColor(locator: import("@playwright/test").Locator) {
  return locator.evaluate((el) => {
    let inner: Element = el;
    while (inner.firstElementChild) inner = inner.firstElementChild;
    return getComputedStyle(inner).color;
  });
}

test("Ctrl+click on a raw www link opens it over https", async ({
  page,
  context,
}) => {
  const { editor, link } = await openWelcomeLink(page);
  await typeLine(page, editor, "Go to www.example.org/raw now.");
  const raw = page.locator(".cm-content .cm-link", {
    hasText: "www.example.org/raw",
  });
  await expect(raw).toHaveText("www.example.org/raw");
  expect(await textColor(raw)).toBe(await textColor(link));

  const pagePromise = context.waitForEvent("page");
  await raw.click({ modifiers: ["Control"] });
  const newPage = await pagePromise;
  await newPage.waitForURL("https://www.example.org/raw");
});

test("Ctrl+click on a markdown link with a www destination opens it over https", async ({
  page,
  context,
}) => {
  const { editor } = await openWelcomeLink(page);
  await typeLine(page, editor, "[scheme-less](www.example.org/md)");
  const link = page.locator(".cm-content .cm-link", {
    hasText: "scheme-less",
  });
  await expect(link).toHaveText("scheme-less");

  const pagePromise = context.waitForEvent("page");
  await link.click({ modifiers: ["Control"] });
  const newPage = await pagePromise;
  await newPage.waitForURL("https://www.example.org/md");
});

async function pasteText(page: import("@playwright/test").Page, value: string) {
  await page.locator(".cm-content").evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, value);
}

test("pasting a URL over a selected word makes an undoable link", async ({
  page,
  context,
}) => {
  const { editor } = await openWelcomeLink(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nvisit docs");
  for (let i = 0; i < "docs".length; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }

  await pasteText(page, "https://www.example.org/pasted");
  await expect(editor).toContainText("[docs](https://www.example.org/pasted)");
  await page
    .locator(".cm-content .cm-line", { hasText: "Notes stay private" })
    .click();
  const link = page.locator(".cm-content .cm-link", { hasText: "docs" });
  await expect(link).toHaveText("docs");

  const pagePromise = context.waitForEvent("page");
  await link.click({ modifiers: ["Control"] });
  const newPage = await pagePromise;
  await newPage.waitForURL("https://www.example.org/pasted");

  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".cm-content .cm-link", { hasText: "docs" })).toHaveCount(0);
  await expect(editor).toContainText("visit docs");
  await expect(editor).not.toContainText("example.org/pasted");
});

test("pasting a URL with no selection inserts it as plain text", async ({
  page,
}) => {
  const { editor } = await openWelcomeLink(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nsee ");

  await pasteText(page, "https://www.example.org/plain");
  await expect(editor).toContainText("see https://www.example.org/plain");
  await expect(editor).not.toContainText("](");
});

test("Mod+Enter with the caret in a link opens it without editing the note", async ({
  page,
}) => {
  const { editor, link } = await openWelcomeLink(page);

  await link.click();
  const before = (await editor.textContent()) ?? "";
  await page.keyboard.press("ControlOrMeta+Enter");

  await expect.poll(() => openedUrls(page)).toEqual([LINK_URL]);
  await expect(editor).toHaveText(before);
});
