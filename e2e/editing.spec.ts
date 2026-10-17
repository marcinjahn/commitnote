import { test, expect } from "./fixtures";
import { openNotes, flushPendingSaves } from "./helpers";
import { headerSyncIcon } from "./helpers/tree";


test("opening a note shows the editor by default, unfocused", { tag: "@mobile" }, async ({
  page,
}, testInfo) => {
  await openNotes(page);

  const welcomeItem = page.getByRole("treeitem", { name: "Welcome" });
  const welcomeRow = welcomeItem.locator("xpath=ancestor::li[1]");
  await expect(welcomeRow.getByRole("img")).toHaveCount(0);

  await welcomeItem.click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Welcome");
  await expect(editor).toContainText("commitnote project");
  await expect(editor).toContainText("Column A");
  await expect(editor).not.toBeFocused();

  const header = page.locator("header.note-header");
  await expect(header.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Welcome",
  );
  await expect(header.getByRole("img")).toHaveCount(0);
  await expect(header).not.toContainText("Synced");

  // On mobile, opening a note hides the tree entirely, so the selected row
  // can only be inspected on desktop.
  if (testInfo.project.name === "desktop") {
    await expect(welcomeItem).toHaveAttribute("aria-selected", "true");
  }
});

test("editing the note autosaves, and the edit is there after reopening it", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("treeitem", { name: "Welcome" }).click();

  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" extra");

  const syncIcon = headerSyncIcon(page);
  await expect(syncIcon).toBeVisible();
  await flushPendingSaves(page);
  await expect(syncIcon).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("treeitem", { name: "Zażółć gęślą jaźń" }).click();
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(
    page.getByRole("textbox", { name: "Note editor" }),
  ).toContainText("extra");
});

test("the focused editor has a 2px outline in forced colours", async ({
  page,
}) => {
  await openNotes(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await page.emulateMedia({ forcedColors: "active" });

  await page.getByRole("textbox", { name: "Note editor" }).click();

  const focused = page.locator(".cm-editor.cm-focused");
  await expect
    .poll(() =>
      focused.evaluate((el) => {
        const style = getComputedStyle(el);
        return { style: style.outlineStyle, width: style.outlineWidth };
      }),
    )
    .toEqual({ style: "solid", width: "2px" });
});

test("clicking the empty area below a short note puts the cursor at its end", { tag: "@mobile" }, async ({
  page,
}, testInfo) => {
  await openNotes(page);

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
