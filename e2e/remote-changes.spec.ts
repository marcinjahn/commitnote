import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  fakeForge,
  flushPendingSaves,
  handOverRepo,
  openNotes,
} from "./helpers";
import { enableVimMode } from "./helpers/settings";
import {
  moveToTrash,
  openRowMenu,
  openWelcome,
  treeItem,
  waitForSynced,
} from "./helpers/tree";

const REMOTE_LINE = "Remote line";

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });

async function refresh(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Refresh" });
  await button.click();
  await expect(button).toHaveAttribute("data-feedback", "success");
}

async function openLoadedWelcome(page: Page): Promise<void> {
  await openWelcome(page);
  await expect(editor(page)).toContainText("This is your");
  await flushPendingSaves(page);
}

async function editRemotely(
  page: Page,
  other: Page,
  line: string,
  { vim = false }: { vim?: boolean } = {},
): Promise<void> {
  await openNotes(other);
  await handOverRepo(page, other);
  await refresh(other);
  await openLoadedWelcome(other);
  await editor(other).click();
  await other.keyboard.press("ControlOrMeta+Home");
  await other.keyboard.press("End");
  if (vim) await other.keyboard.press("a");
  await other.keyboard.press("Enter");
  await other.keyboard.type(line);
  if (vim) await other.keyboard.press("Escape");
  await flushPendingSaves(other);
  await waitForSynced(other);
  await handOverRepo(other, page);
}

test("a remote edit keeps the caret on the same text", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);
  await page.locator(".cm-line", { hasText: "Notes stay private" }).click();
  await page.keyboard.press("End");

  const other = await openSecondDevice();
  await editRemotely(page, other.page, REMOTE_LINE);
  await refresh(page);
  await expect(editor(page)).toContainText(REMOTE_LINE);

  await editor(page).focus();
  await page.keyboard.type("Q");
  await expect(
    page.locator(".cm-line", { hasText: "Notes stay private" }),
  ).toContainText("hosts them.Q");
});

test("Undo after a remote edit reverts only the local edit", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("localword");
  await flushPendingSaves(page);
  await waitForSynced(page);

  const other = await openSecondDevice();
  await editRemotely(page, other.page, REMOTE_LINE);
  await refresh(page);
  await expect(editor(page)).toContainText(REMOTE_LINE);
  await expect(editor(page)).toContainText("localword");

  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).not.toContainText("localword");
  await expect(editor(page)).toContainText(REMOTE_LINE);
});

test("vim normal mode survives a remote edit", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await openLoadedWelcome(page);
  const mode = page.locator(".vim-status-bar .mode-label");
  await expect(mode).toHaveText("NORMAL");
  await editor(page).focus();
  await expect(editor(page)).toBeFocused();

  const other = await openSecondDevice();
  await editRemotely(page, other.page, REMOTE_LINE, { vim: true });
  await refresh(page);
  await expect(editor(page)).toContainText(REMOTE_LINE);

  await expect(mode).toHaveText("NORMAL");
  await editor(page).focus();
  await expect(page.locator(".cm-fat-cursor:visible")).toHaveCount(1);
});

test("a remote edit is announced politely", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);

  const other = await openSecondDevice();
  await editRemotely(page, other.page, REMOTE_LINE);
  await refresh(page);

  await expect(page.getByTestId("status-announcer")).toHaveText(
    "Updated on another device.",
  );
  await expect(
    page.getByRole("group").filter({ hasText: "Updated on another device." }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function renameOpenNote(page: Page, name: string): Promise<void> {
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill(name);
  await field.press("Enter");
  await expect(field).toHaveValue(name);
}

async function handOverAfterSave(from: Page, to: Page): Promise<void> {
  await flushPendingSaves(from);
  await waitForSynced(from);
  await handOverRepo(from, to);
}

async function expectFollowed(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    name,
  );
  await expect(treeItem(page, name)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("This note no longer exists.")).toHaveCount(0);
  await expect(page.getByTestId("status-announcer")).toHaveText(
    "Moved on another device.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("follows a remote rename of the open note", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);

  const other = await openSecondDevice();
  await openNotes(other.page);
  await openLoadedWelcome(other.page);
  await renameOpenNote(other.page, "Greetings");
  await handOverAfterSave(other.page, page);

  await refresh(page);
  await expectFollowed(page, "Greetings");
  await expect(editor(page)).toContainText("This is your");
  await expect(treeItem(page, "Welcome")).toHaveCount(0);
});

test("follows a remote folder rename", async ({ page, openSecondDevice }) => {
  await openNotes(page);
  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();
  await treeItem(page, "Roadmap").click();
  await expect(editor(page)).toContainText("Add mobile client");

  const other = await openSecondDevice();
  await openNotes(other.page);
  await treeItem(other.page, "Projects").click();
  await openRowMenu(other.page, "commitnote");
  await other.page.getByRole("menuitem", { name: "Rename…" }).click();
  await other.page.getByLabel("Folder name").fill("product");
  await other.page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(treeItem(other.page, "product")).toBeVisible();
  await handOverAfterSave(other.page, page);

  await refresh(page);
  await expectFollowed(page, "Roadmap");
  await expect(editor(page)).toContainText("Add mobile client");
  await expect(treeItem(page, "product")).toBeVisible();
  await expect(treeItem(page, "commitnote")).toHaveCount(0);
});

test("follows a remote move of the open note to another folder", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);

  const other = await openSecondDevice();
  await openNotes(other.page);
  await openRowMenu(other.page, "Welcome");
  await other.page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await other.page
    .getByRole("radiogroup", { name: "Folder" })
    .getByRole("radio", { name: "Projects", exact: true })
    .check();
  await other.page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
  await expect(treeItem(other.page, "Welcome")).toHaveCount(0);
  await handOverAfterSave(other.page, page);

  await refresh(page);
  await expectFollowed(page, "Welcome");
  await expect(editor(page)).toContainText("This is your");
  await expect(treeItem(page, "Projects")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("keeps the caret and undo across a followed rename", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);
  await page.locator(".cm-line", { hasText: "Notes stay private" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("localword");
  await waitForSynced(page);

  const other = await openSecondDevice();
  await openNotes(other.page);
  await handOverRepo(page, other.page);
  await refresh(other.page);
  await openLoadedWelcome(other.page);
  await renameOpenNote(other.page, "Greetings");
  await handOverAfterSave(other.page, page);

  await refresh(page);
  await expectFollowed(page, "Greetings");
  await expect(editor(page)).toContainText("localword");

  await editor(page).focus();
  await page.keyboard.type("Q");
  await expect(
    page.locator(".cm-line", { hasText: "Notes stay private" }),
  ).toContainText("localwordQ");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).not.toContainText("localword");
});

test("follows a remote rename plus edit in one commit", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);

  const other = await openSecondDevice();
  await other.page.clock.install();
  await openNotes(other.page);
  await openLoadedWelcome(other.page);
  await editor(other.page).click();
  await other.page.keyboard.press("ControlOrMeta+End");
  await other.page.keyboard.type(" Renamed and edited.");
  await renameOpenNote(other.page, "Greetings");
  await flushPendingSaves(other.page);
  await waitForSynced(other.page);

  await expect
    .poll(async () => (await fakeForge(other.page).commitMessages())[0])
    .toContain("Commitnote-Rename");
  await handOverRepo(other.page, page);

  await refresh(page);
  await expectFollowed(page, "Greetings");
  await expect(editor(page)).toContainText("Renamed and edited.");
});

const TRASHED_TEXT = "This note was moved to trash.";

test("a remotely trashed open note offers Restore", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await openLoadedWelcome(page);

  const other = await openSecondDevice();
  await openNotes(other.page);
  await moveToTrash(other.page, "Welcome");
  await handOverAfterSave(other.page, page);

  await refresh(page);
  await expect(page.getByText(TRASHED_TEXT)).toBeVisible();
  await expect(page.getByText("This note no longer exists.")).toHaveCount(0);
  await expect(page.getByTestId("status-announcer")).toHaveText(
    "Moved to trash on another device.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(treeItem(page, "Welcome")).toBeVisible();
  await expect(page.getByText(TRASHED_TEXT)).toHaveCount(0);
  await expect(editor(page)).toContainText("This is your");
});

test("a remotely trashed folder offers Restore folder", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();
  await treeItem(page, "Roadmap").click();
  await expect(editor(page)).toContainText("Add mobile client");

  const other = await openSecondDevice();
  await openNotes(other.page);
  await moveToTrash(other.page, "Projects");
  await handOverAfterSave(other.page, page);

  await refresh(page);
  await expect(page.getByText(TRASHED_TEXT)).toBeVisible();
  await page.getByRole("button", { name: "Restore folder" }).click();

  await expect(treeItem(page, "Projects")).toBeVisible();
  await expect(page.getByText(TRASHED_TEXT)).toHaveCount(0);
  await expect(editor(page)).toContainText("Add mobile client");
});
