import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { flushPendingSaves, handOverRepo, openNotes } from "./helpers";
import { enableVimMode } from "./helpers/settings";
import { openWelcome, waitForSynced } from "./helpers/tree";

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
