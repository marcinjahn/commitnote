import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { fakeForge, flushPendingSaves, openNotes, showTree } from "./helpers";
import {
  headerSyncIcon,
  openWelcome,
  treeItem,
  waitForSynced,
} from "./helpers/tree";

const OFFLINE_LONG =
  "Offline. Changes will save when you're back online. Keep this tab open.";

async function editIdeasOffline(page: Page): Promise<void> {
  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();
  await treeItem(page, "Ideas").click();
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.type(" offline idea");
  await flushPendingSaves(page);
}

test("edits wait while offline and save as soon as the browser is back online", async ({
  page,
}) => {
  await openNotes(page);
  await openWelcome(page);
  const commitsBefore = await fakeForge(page).commitCount();

  await page.context().setOffline(true);
  try {
    await page.getByRole("textbox", { name: "Note editor" }).click();
    await page.keyboard.type(" written offline");
    await flushPendingSaves(page);

    await expect(headerSyncIcon(page)).toHaveAccessibleName(
      "Out of sync: waiting to save",
    );
    expect(await fakeForge(page).commitCount()).toBe(commitsBefore);
  } finally {
    await page.context().setOffline(false);
  }

  await waitForSynced(page);
  await expect
    .poll(() => fakeForge(page).commitCount())
    .toBe(commitsBefore + 1);
});

test("the sync status button shows offline and opens an unsaved note from its menu", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNotes(page);
  await showTree(page);
  const button = page.getByRole("button", { name: "Offline", exact: true });

  await page.context().setOffline(true);
  await expect(button).toBeVisible();

  await editIdeasOffline(page);
  await showTree(page);
  await page.getByRole("button", { name: OFFLINE_LONG }).click();
  const menu = page.getByRole("menu", { name: "Unsaved notes" });
  await expect(
    menu.getByRole("menuitem", { name: "Ideas — Projects / commitnote" }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Retry now" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await treeItem(page, "Projects").click();
  await expect(treeItem(page, "Ideas")).toHaveCount(0);

  await page.getByRole("button", { name: OFFLINE_LONG }).click();
  await menu
    .getByRole("menuitem", { name: "Ideas — Projects / commitnote" })
    .click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
    "Ideas",
  );
  await expect(treeItem(page, "Ideas")).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByRole("button", { name: /^Offline/ })).toHaveCount(0);
});

test("on mobile the sync status button opens an unsaved note into the note view", { tag: "@mobile" }, async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNotes(page);
  await page.context().setOffline(true);
  await editIdeasOffline(page);
  await showTree(page);

  await page.getByRole("button", { name: OFFLINE_LONG }).click();
  await page
    .getByRole("menuitem", { name: "Ideas — Projects / commitnote" })
    .click();
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
});

test("the status announcer reports going offline and the recovery, and stays quiet otherwise", async ({
  page,
}) => {
  await openNotes(page);
  const announcer = page.getByTestId("status-announcer");
  await expect(announcer).toHaveRole("status");
  await expect(announcer).toBeEmpty();
  await expect(page.locator("#sidebar").getByTestId("status-announcer")).toHaveCount(0);
  await expect(page.locator("#note-pane").getByTestId("status-announcer")).toHaveCount(0);

  await openWelcome(page);
  await page.getByRole("textbox", { name: "Note editor" }).click();
  await page.keyboard.type(" ordinary edit");
  await waitForSynced(page);
  await expect(announcer).toBeEmpty();

  await page.context().setOffline(true);
  try {
    await expect(announcer).toHaveText("Offline");
    await page.getByRole("textbox", { name: "Note editor" }).click();
    await page.keyboard.type(" written offline");
    await flushPendingSaves(page);
  } finally {
    await page.context().setOffline(false);
  }

  await waitForSynced(page);
  await expect(announcer).toHaveText("All changes saved");
});
