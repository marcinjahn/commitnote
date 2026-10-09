import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree, fakeForge } from "./helpers";
import { headerSyncIcon, openHistory, waitForSynced } from "./helpers/tree";


async function appendText(page: Page, text: string): Promise<void> {
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
  await expect(
    headerSyncIcon(page),
  ).toBeVisible();
  await waitForSynced(page);
}

async function renameOpenNote(page: Page, name: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill(name);
  await field.press("Enter");
  await expect(
    headerSyncIcon(page),
  ).toBeVisible();
  await waitForSynced(page);
}

/** "Welcome" with a last line typed in three saves, then renamed to "Hello". */
async function noteWithHistory(page: Page): Promise<void> {
  await openNotes(page);
  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  await appendText(page, "one");
  await appendText(page, " two");
  await appendText(page, " three");
  await renameOpenNote(page, "Hello");
}

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("lists the note's versions with an editing session and labels", async ({
    page,
  }) => {
    await noteWithHistory(page);

    const dialog = await openHistory(page);

    const rows = dialog.getByTestId("version-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Current");
    await expect(rows.nth(0)).toContainText("Renamed from “Welcome”");
    await expect(rows.nth(1)).toContainText(" · 3 saves");
    await expect(rows.nth(1)).toContainText("Welcome");
    await expect(rows.nth(2)).toContainText("Created");
    await expect(dialog.getByRole("heading", { name: "Today" })).toBeVisible();

    await dialog.getByRole("button", { name: "Show 3 saves" }).click();
    await expect(rows).toHaveCount(5);
  });

  test("closing the history dialog returns focus to its opener", async ({
    page,
  }) => {
    await noteWithHistory(page);

    const dialog = await openHistory(page);
    await page.keyboard.press("Escape");

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Version history" })).toBeFocused();
  });

  test("arrow keys, Home and End move through rows and session toggles in order", async ({
    page,
  }) => {
    await noteWithHistory(page);
    const dialog = await openHistory(page);
    const rows = dialog.getByTestId("version-row");
    const toggle = dialog.getByRole("button", { name: "Show 3 saves" });

    await rows.nth(1).focus();
    await page.keyboard.press("ArrowDown");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(1)).toBeFocused();

    await page.keyboard.press("End");
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rows.nth(0)).toBeFocused();
  });

  test("shows what restoring a version would change", { tag: "@mobile" }, async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === "mobile";
    await noteWithHistory(page);

    const dialog = await openHistory(page);
    const rows = dialog.getByTestId("version-row");
    const detail = dialog.getByTestId("version-detail");
    const summary = detail.getByTestId("diff-summary");

    async function select(index: number): Promise<void> {
      if (mobile && (await detail.isVisible())) {
        await dialog.getByRole("button", { name: "All versions" }).click();
        await expect(detail).toBeHidden();
      }
      await rows.nth(index).click();
      await expect(detail).toBeVisible();
      await expect(rows.nth(index)).toHaveAttribute("aria-current", "true");
    }

    if (mobile) {
      await expect(detail).toBeHidden();
    } else {
      await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
      await expect(detail.getByTestId("diff-title")).toHaveText(
        "Title: “Hello” → “Welcome”",
      );
    }

    await dialog.getByRole("button", { name: "Show 3 saves" }).click();
    await select(3);
    if (mobile) await expect(rows.nth(3)).toBeHidden();
    await expect(summary).toHaveText("Restoring would change: +1 added −1 removed lines");
    const line = (kind: string) =>
      detail.locator(`[data-testid='diff-line'][data-kind='${kind}']`);
    await expect(line("removed")).toHaveText(/one two three$/);
    await expect(line("added")).toHaveText(/one$/);
    await expect(line("removed").locator("mark")).toHaveText(" two three");
    await expect(detail.getByTestId("diff-title")).toHaveText(
      "Title: “Hello” → “Welcome”",
    );

    if (mobile) {
      await dialog.getByRole("button", { name: "All versions" }).click();
      await expect(detail).toBeHidden();
      await expect(rows.nth(3)).toBeFocused();
    }

    await select(0);
    await expect(summary).toHaveText("Same as the current version.");

    await select(4);
    await expect(summary).toHaveText("Restoring would change: +0 added −1 removed line");
    await expect(line("removed")).toHaveText(/one two three$/);
    await expect(detail).toContainText("Adds a line break at the end.");
  });
});

test("the history button is hidden while naming a new note", async ({
  page,
}) => {
  await openNotes(page);

  await page.getByRole("button", { name: "New note", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "Note name" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Version history" }),
  ).toHaveCount(0);
});

const RESTORE = "Restore this version";
const RESTORE_TITLE = "Also restore the title “Welcome”";

function noteEditor(page: Page) {
  return page.getByRole("textbox", { name: "Note editor" });
}

function noteNameField(page: Page) {
  return page.getByRole("textbox", { name: "Note name" });
}

function lastEditorLine(page: Page) {
  return noteEditor(page).locator(".cm-line").last();
}

function restoredToast(page: Page) {
  return page.getByRole("group").filter({
    hasText: /Restored the version from today, \d\d:\d\d( [AP]M)?\./,
  });
}

/** Opens the history and selects the save that left the last line as "one". */
async function selectFirstSave(page: Page) {
  const dialog = await openHistory(page);
  await dialog.getByRole("button", { name: "Show 3 saves" }).click();
  await dialog.getByTestId("version-row").nth(3).click();
  await expect(dialog.getByTestId("diff-summary")).toHaveText(
    "Restoring would change: +1 added −1 removed lines",
  );
  return dialog;
}

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("restores a version's content and keeps the current title; typing afterwards takes away its Undo", async ({
    page,
  }) => {
    await noteWithHistory(page);
    const dialog = await selectFirstSave(page);
    await expect(
      dialog.getByRole("checkbox", { name: RESTORE_TITLE }),
    ).not.toBeChecked();

    await test.step("restore", async () => {
      await dialog.getByRole("button", { name: RESTORE }).click();

      await expect(dialog).toHaveCount(0);
      await expect(restoredToast(page)).toBeVisible();
      await expect(lastEditorLine(page)).toHaveText("one");
      await expect(noteNameField(page)).toHaveValue("Hello");
      await expect(headerSyncIcon(page)).toBeVisible();
      await waitForSynced(page);

      const reopened = await openHistory(page);
      await expect(reopened.getByTestId("version-row")).toHaveCount(4);
      await reopened.getByRole("button", { name: "Close" }).click();
      await expect(reopened).toHaveCount(0);
    });

    await test.step("typing takes away the Undo", async () => {
      await expect(restoredToast(page)).toBeVisible();
      await noteEditor(page).click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(" four");

      await expect(restoredToast(page)).toHaveCount(0);
      await expect(lastEditorLine(page)).toHaveText("one four");
      await waitForSynced(page);
      await expect(lastEditorLine(page)).toHaveText("one four");
    });
  });

  test("restores a version's content together with its title, and Undo puts both back", async ({
    page,
  }) => {
    await noteWithHistory(page);
    const dialog = await selectFirstSave(page);

    await test.step("restore", async () => {
      await dialog.getByRole("checkbox", { name: RESTORE_TITLE }).check();
      await dialog.getByRole("button", { name: RESTORE }).click();

      await expect(dialog).toHaveCount(0);
      await expect(noteNameField(page)).toHaveValue("Welcome");
      await expect(lastEditorLine(page)).toHaveText("one");
      await waitForSynced(page);
      await showTree(page);
      await expect(
        page.getByRole("treeitem", { name: "Welcome", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("treeitem", { name: "Hello", exact: true }),
      ).toHaveCount(0);
    });

    await test.step("Undo", async () => {
      await restoredToast(page).getByRole("button", { name: "Undo" }).click();

      await expect(restoredToast(page)).toHaveCount(0);
      await expect(lastEditorLine(page)).toHaveText("one two three");
      await expect(noteNameField(page)).toHaveValue("Hello");
      await waitForSynced(page);
    });
  });

  test("restoring a title another note already has shows why and changes nothing", async ({
    page,
  }) => {
    await noteWithHistory(page);
    await showTree(page);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await noteNameField(page).fill("Welcome");
    await noteNameField(page).press("Enter");
    await waitForSynced(page);
    await showTree(page);
    await page.getByRole("treeitem", { name: "Hello", exact: true }).click();
    await expect(lastEditorLine(page)).toHaveText("one two three");

    const dialog = await selectFirstSave(page);
    await dialog.getByRole("checkbox", { name: RESTORE_TITLE }).check();
    await dialog.getByRole("button", { name: RESTORE }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "A note or folder with this name already exists here.",
    );
    await dialog.getByRole("checkbox", { name: RESTORE_TITLE }).uncheck();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(lastEditorLine(page)).toHaveText("one two three");
    await expect(noteNameField(page)).toHaveValue("Hello");
  });
});

test("a note with a conflict can't be restored until the conflict is resolved", async ({
  page,
}) => {
  await openNotes(page);
  const editRemotely = fakeForge(page).editNote;
  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  await noteEditor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.type("# Welcome from here");
  await editRemotely(["Welcome"], "# Welcome from elsewhere\n");
  await expect(page.getByRole("region", { name: "Conflict" })).toBeVisible({
    timeout: 10_000,
  });

  const dialog = await openHistory(page);
  await dialog.getByTestId("version-row").nth(1).click();
  await expect(dialog.getByTestId("version-diff")).toBeVisible();

  await expect(dialog.getByRole("button", { name: RESTORE })).toBeDisabled();
  await expect(dialog.getByText("Resolve the conflict first.")).toBeVisible();
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("in forced colours the selected version row has a bar", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop only");
    await noteWithHistory(page);
    const dialog = await selectFirstSave(page);
    await page.emulateMedia({ forcedColors: "active" });

    const row = dialog.getByTestId("version-row").nth(3);
    const bar = await row.evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return { background: style.backgroundColor, width: style.width };
    });
    expect(bar.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(bar.width).toBe("2px");
  });
});
