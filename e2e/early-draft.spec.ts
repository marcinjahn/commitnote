import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  expectTree,
  fakeForge,
  flushPendingSaves,
  holdOnLoad,
  logIn,
  openNotes,
  SAMPLE,
  showTree,
} from "./helpers";
import { treeItem } from "./helpers/tree";

const AUTO_NAME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function newNoteButton(page: Page) {
  return page.getByRole("button", { name: "New note", exact: true });
}

function nameField(page: Page) {
  return page.getByRole("textbox", { name: "Note name" });
}

function createCommits(messages: readonly string[]): number {
  return messages.filter((message) => message.includes("Commitnote-Create:")).length;
}

async function holdLoadingScreen(page: Page, url?: string): Promise<void> {
  await holdOnLoad(page, "listTree");
  if (url === undefined) await page.reload();
  else await page.goto(url);
  await expect(page.getByText("Loading…")).toBeVisible();
}

test("an early draft typed on the loading screen becomes a note once the notes load", async ({
  page,
}) => {
  await openNotes(page);
  await holdOnLoad(page, "listTree");
  await page.reload();
  await expect(page.getByText("Loading…")).toBeVisible();

  await page.getByRole("button", { name: "New note", exact: true }).click();
  const nameField = page.getByRole("textbox", { name: "Note name" });
  await expect(nameField).toBeFocused();
  await page.keyboard.type("Early idea");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Typed before the notes loaded");

  await fakeForge(page).release("listTree");
  await expectTree(page);

  await expect(nameField).toHaveCount(1);
  await expect(nameField).toHaveValue("Early idea");
  const editor = page.locator("#note-pane .cm-content");
  await expect(editor).toHaveText("Typed before the notes loaded");
  await expect(editor).toBeFocused();
});

test(
  "the New note button on the loading screen sits where it does in the tree and starts a note",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await openNotes(page);
    const createsBefore = createCommits(await fakeForge(page).commitMessages());

    await holdLoadingScreen(page);
    const button = newNoteButton(page);
    await expect(button.getByText("New note")).toBeVisible();
    const viewport = page.viewportSize()!;
    await expect
      .poll(async () => {
        const box = (await button.boundingBox())!;
        return [
          Math.round(viewport.width - (box.x + box.width)),
          Math.round(viewport.height - (box.y + box.height)),
        ];
      })
      .toEqual([24, 24]);

    await button.tap();
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.type("Tapped note");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Tapped body");

    await fakeForge(page).release("listTree");

    const editor = page.locator("#note-pane .cm-content");
    await expect(editor).toHaveText("Tapped body");
    await expect(editor).toBeFocused();
    await expect(nameField(page)).toHaveValue("Tapped note");
    await showTree(page);
    await expect(
      page.locator('[role="treeitem"][aria-level="1"]', { hasText: "Tapped note" }),
    ).toHaveCount(1);

    await flushPendingSaves(page);
    await expect
      .poll(async () => createCommits(await fakeForge(page).commitMessages()))
      .toBe(createsBefore + 1);
  },
);

test("a body typed without a name gets an automatic name", async ({ page }) => {
  await openNotes(page);
  await holdLoadingScreen(page);

  await newNoteButton(page).click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Only a body");

  await fakeForge(page).release("listTree");
  await expectTree(page);

  await expect(nameField(page)).toHaveValue(AUTO_NAME);
  await expect(page.locator("#note-pane .cm-content")).toHaveText("Only a body");
  await expect(treeItem(page, AUTO_NAME)).toBeVisible();
});

test("a typed name that clashes with an existing note shows the name error and keeps the text", async ({
  page,
}) => {
  await openNotes(page);
  await holdLoadingScreen(page);

  await newNoteButton(page).click();
  await page.keyboard.type("Welcome");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Kept body");

  await fakeForge(page).release("listTree");
  await expectTree(page);

  await expect(page.getByRole("alert")).toHaveText(
    "A note or folder with this name already exists here.",
  );
  await expect(nameField(page)).toHaveValue("Welcome");
  await expect(page.locator("#note-pane .cm-content")).toHaveText("Kept body");
});

test("typing continues across the handoff", async ({ page }) => {
  await openNotes(page);
  await holdLoadingScreen(page);

  await newNoteButton(page).click();
  await page.keyboard.type("Streaming");
  await page.keyboard.press("Enter");
  await page.keyboard.type("before the release, ");

  await fakeForge(page).release("listTree");
  await page.keyboard.type("and after the release");
  await expectTree(page);

  await expect(page.locator("#note-pane .cm-content")).toHaveText(
    "before the release, and after the release",
  );
  await expect(nameField(page)).toHaveValue("Streaming");
});

test("the new-note launch action during a held load opens one early draft that is handed off", async ({
  page,
}) => {
  await openNotes(page);
  await holdLoadingScreen(page, "/?action=new-note");

  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type("Launched");

  await fakeForge(page).release("listTree");
  await expectTree(page);

  await expect(nameField(page)).toHaveCount(1);
  await expect(nameField(page)).toHaveValue("Launched");
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("typing on the loading screen starts an early draft with the typed text", async ({
  page,
}) => {
  await openNotes(page);
  await holdLoadingScreen(page);
  await expect(newNoteButton(page)).toBeVisible();

  await page.keyboard.type("Quick thought");

  await expect(nameField(page)).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Note editor" });
  await expect(editor).toHaveText("Quick thought");

  await fakeForge(page).release("listTree");
  await expectTree(page);
  await expect(page.locator("#note-pane .cm-content")).toHaveText("Quick thought");
});

async function typeEarlyDraftAndFailInspect(page: Page, kind: string): Promise<void> {
  await openNotes(page);
  await holdOnLoad(page, "inspect");
  await page.reload();

  await newNoteButton(page).click();
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type("Rescued idea");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Typed while loading failed");

  await fakeForge(page).failNext("inspect", kind);
  await fakeForge(page).release("inspect");
}

async function expectCreatedNote(page: Page, createsBefore: number): Promise<void> {
  await expectTree(page);
  await expect(nameField(page)).toHaveValue("Rescued idea");
  await expect(page.locator("#note-pane .cm-content")).toHaveText(
    "Typed while loading failed",
  );
  await flushPendingSaves(page);
  await expect
    .poll(async () => createCommits(await fakeForge(page).commitMessages()))
    .toBe(createsBefore + 1);
}

test("an early draft survives an authorization failure and is created after logging in again", async ({
  page,
}) => {
  await openNotes(page);
  const createsBefore = createCommits(await fakeForge(page).commitMessages());

  await typeEarlyDraftAndFailInspect(page, "Unauthorized");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("This note is not saved yet.");
  await expect(alert.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(nameField(page)).toHaveValue("Rescued idea");
  const body = page.getByRole("textbox", { name: "Note editor" });
  await expect(body).toHaveText("Typed while loading failed");
  await body.click({ clickCount: 3 });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toContain("Typed while loading failed");

  await alert.getByRole("button", { name: "Log in" }).click();
  const unsaved = page.getByRole("region", { name: "Unsaved note" });
  await expect(unsaved).toContainText("Rescued idea");
  await expect(unsaved).toContainText("Typed while loading failed");

  await logIn(page, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectCreatedNote(page, createsBefore);
});

test("an early draft survives a network failure and is created after trying again", async ({
  page,
}) => {
  await openNotes(page);
  const createsBefore = createCommits(await fakeForge(page).commitMessages());

  await typeEarlyDraftAndFailInspect(page, "Network");

  const alert = page.getByRole("alert");
  await expect(nameField(page)).toHaveValue("Rescued idea");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expectCreatedNote(page, createsBefore);
});

test("a late load failure with no action still lets the user leave the early draft", async ({
  page,
}) => {
  await openNotes(page);
  await holdLoadingScreen(page);

  await newNoteButton(page).click();
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type("Kept idea");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Kept body");

  await fakeForge(page).failNext("listTree", "TreeTruncated");
  await fakeForge(page).release("listTree");

  await expect(page.getByRole("alert")).toContainText(
    "This notes repo is too large to load.",
  );
  const back = page.getByRole("button", { name: "Back to notes" });
  await expect(back).toBeVisible();
  await back.click();

  await expect(nameField(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to notes" })).toHaveCount(0);
  await expect(page.locator(".phase-content")).not.toHaveAttribute("inert");
});
