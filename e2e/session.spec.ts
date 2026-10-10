import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, SAMPLE, openNotes, logOut, fakeForge, flushPendingSaves, onFakeForgeReady } from "./helpers";
import { closeSettings, openSettings } from "./helpers/settings";
import { moveToTrash, treeItem } from "./helpers/tree";


async function openWelcomeAndType(page: Page, text: string): Promise<void> {
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test("logging out saves pending edits first", async ({ page }) => {
  await openNotes(page, { via: "login" });
  await openWelcomeAndType(page, " typed before logout");
  await logOut(page);

  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });

  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
    "typed before logout",
  );
});

test("keep trying retries the save and then logs out", async ({ page }) => {
  await openNotes(page, { via: "login" });
  await openWelcomeAndType(page, " unsaved");
  await fakeForge(page).failNext("commit", "Network");
  await logOut(page);

  const dialog = page.getByRole("dialog", { name: "Some changes are not saved" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("1 note or folder is not saved yet.");

  await dialog.getByRole("button", { name: "Keep trying" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
});

test("log out anyway discards unsaved changes", async ({ page }) => {
  await openNotes(page, { via: "login" });
  await openWelcomeAndType(page, " unsaved");
  await fakeForge(page).failNext("commit", "Network");
  await fakeForge(page).failNext("commit", "Network");
  await logOut(page);

  const dialog = page.getByRole("dialog", { name: "Some changes are not saved" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Keep trying" }).click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("1 note or folder is not saved yet.");

  await dialog.getByRole("button", { name: "Log out anyway" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
});

test("logging out leaves no note fragment in the URL", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("treeitem", { name: "Welcome" }).click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^#n=/);

  await logOut(page);

  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
  expect(new URL(page.url()).hash).toBe("");
});

test.describe("last view", () => {
  const REOPEN = "Reopen the last note and folders";

  function storedLastView(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("commitnote.lastView."),
      );
      return key === undefined ? null : localStorage.getItem(key);
    });
  }

  async function storedNote(page: Page): Promise<string | null> {
    const raw = await storedLastView(page);
    return raw === null ? null : (JSON.parse(raw) as { note: string | null }).note;
  }

  async function enableOption(page: Page): Promise<void> {
    const dialog = await openSettings(page);
    await dialog.getByRole("checkbox", { name: REOPEN, exact: true }).check();
    await closeSettings(page);
  }

  async function openIdeasWithJournalExpanded(page: Page): Promise<void> {
    await treeItem(page, "Journal").click();
    await expect(treeItem(page, "Journal")).toHaveAttribute("aria-expanded", "true");
    await treeItem(page, "Projects").click();
    await treeItem(page, "commitnote").click();
    await treeItem(page, "Ideas").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Ideas");
  }

  async function revisit(page: Page): Promise<void> {
    await page.goto("/");
  }

  test("reopens the last note and expanded folders when the option is on", async ({ page }) => {
    await openNotes(page);
    await enableOption(page);
    await openIdeasWithJournalExpanded(page);
    await expect.poll(() => storedNote(page)).not.toBeNull();

    await revisit(page);

    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Ideas");
    for (const folder of ["Projects", "commitnote", "Journal"]) {
      await expect(treeItem(page, folder)).toHaveAttribute("aria-expanded", "true");
    }
  });

  test("opens nothing when the option is off", async ({ page }) => {
    await openNotes(page);
    await openIdeasWithJournalExpanded(page);

    await revisit(page);

    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveCount(0);
    await expect(treeItem(page, "Journal")).toHaveAttribute("aria-expanded", "false");
  });

  test("skips a trashed note and keeps the folders that remain", async ({
    page,
    openSecondDevice,
  }) => {
    await openNotes(page);
    await enableOption(page);
    await openIdeasWithJournalExpanded(page);
    await expect.poll(() => storedNote(page)).not.toBeNull();

    const second = await openSecondDevice();
    await openNotes(second.page);
    await treeItem(second.page, "Projects").click();
    await treeItem(second.page, "commitnote").click();
    const commitsBefore = await fakeForge(second.page).commitCount();
    await moveToTrash(second.page, "Ideas");
    await flushPendingSaves(second.page);
    await expect
      .poll(() => fakeForge(second.page).commitCount())
      .toBeGreaterThan(commitsBefore);
    await onFakeForgeReady(
      page,
      (controls, arg) => controls.adoptRepo(arg.key, arg.exported),
      { key: SAMPLE.key, exported: await fakeForge(second.page).exportRepo() },
    );

    await revisit(page);

    await expect(treeItem(page, "Projects")).toHaveAttribute("aria-expanded", "true");
    await expect(treeItem(page, "Journal")).toHaveAttribute("aria-expanded", "true");
    await expect(treeItem(page, "Roadmap")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("stores no note or folder names", async ({ page }) => {
    await openNotes(page);
    await enableOption(page);
    await openIdeasWithJournalExpanded(page);
    await expect.poll(() => storedNote(page)).not.toBeNull();

    const stored = (await storedLastView(page))!;
    for (const name of ["Ideas", "Projects", "Journal", "commitnote"]) {
      expect(stored).not.toContain(name);
    }
  });

  test("a note fragment wins over the last view", async ({ page }) => {
    await openNotes(page);
    await enableOption(page);
    await openIdeasWithJournalExpanded(page);
    await expect.poll(() => storedNote(page)).not.toBeNull();
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#n=/);
    const ideasUrl = page.url();
    const ideasStored = await storedNote(page);

    await treeItem(page, "Welcome").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Welcome");
    await expect.poll(() => storedNote(page)).not.toBe(ideasStored);

    const other = await page.context().newPage();
    await other.goto(ideasUrl);

    await expect(other.getByRole("textbox", { name: "Note name" })).toHaveValue("Ideas");
  });

  test("shows the restored note's view on mobile @mobile", async ({ page }) => {
    await openNotes(page);
    await enableOption(page);
    await openIdeasWithJournalExpanded(page);
    await expect.poll(() => storedNote(page)).not.toBeNull();

    await revisit(page);

    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue("Ideas");
    await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
  });
});
