import { test, expect } from "./fixtures";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";

test("opening a note shows the editor by default, unfocused", { tag: "@mobile" }, async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Welcome");
  await expect(editor).not.toBeFocused();
});

test("editing the note autosaves, and the edit is there after reopening it", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" extra");

  const header = page.locator("header.note-header");
  const syncIcon = header.getByRole("img");
  await expect(syncIcon).toBeVisible();
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("treeitem", { name: "Zażółć gęślą jaźń" }).click();
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText("extra");
});

test("clicking the empty area below a short note puts the cursor at its end", { tag: "@mobile" }, async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.getByRole("treeitem", { name: "Zażółć gęślą jaźń" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toContainText("Testing non-ASCII");

  const pane = page.locator(".note-content");
  const box = await pane.boundingBox();
  if (box === null) throw new Error("note pane is not rendered");
  const position = { x: box.width / 2, y: box.height - 20 };
  if (testInfo.project.name === "mobile") {
    await pane.tap({ position });
  } else {
    await pane.click({ position });
  }

  await expect(editor).toBeFocused();
  await page.keyboard.type("appended");
  await expect(editor.locator(".cm-line").last()).toHaveText("appended");
  await expect(editor.locator(".cm-line").nth(2)).toHaveText(
    "Testing non-ASCII note names end to end.",
  );
});
