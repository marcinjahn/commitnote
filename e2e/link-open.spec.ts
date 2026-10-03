import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const LINK_URL = "https://github.com/example/commitnote";

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Ctrl+click is desktop-only");
  await context.route("https://github.com/example/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>stub</title>",
    }),
  );
});

async function openWelcomeLink(page: import("@playwright/test").Page) {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
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
  await page.waitForTimeout(500);

  expect(context.pages().length).toBe(pageCount);
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
  await page.waitForTimeout(500);

  expect(context.pages().length).toBe(pageCount);
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
  await page.waitForTimeout(500);

  expect(context.pages().length).toBe(pageCount);
});
