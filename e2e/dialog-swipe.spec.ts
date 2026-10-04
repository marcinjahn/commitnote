import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expectTree, logIn, TouchFinger, type TouchPoint } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const REPO_KEY = "sample/notes";

function commitMessages(page: Page): Promise<string[]> {
  return page.evaluate(
    (repoKey) =>
      (window as any).__commitNoteFakeForge.commitMessages(repoKey) as string[],
    REPO_KEY,
  );
}

async function startSession(page: Page): Promise<void> {
  await page.goto("/");
  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
}

function settingsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Settings" });
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseAccent(page: Page, name: string): Promise<void> {
  await settingsDialog(page)
    .getByRole("radiogroup", { name: "Accent color" })
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) })
    .click();
}

async function moveToTrash(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function openTrash(page: Page): Promise<Locator> {
  await page.getByTestId("open-trash").click();
  const dialog = page.getByRole("dialog", { name: "Trash" });
  await expect(dialog).toBeVisible();
  return dialog;
}

interface Geometry {
  readonly grab: TouchPoint;
  readonly cardHeight: number;
}

async function settledBox(target: Locator) {
  let previous = JSON.stringify(await target.boundingBox());
  await expect
    .poll(async () => {
      const current = JSON.stringify(await target.boundingBox());
      const settled = current === previous;
      previous = current;
      return settled;
    })
    .toBe(true);
  return (await target.boundingBox())!;
}

async function geometry(
  dialog: Locator,
  startOn?: Locator,
): Promise<Geometry> {
  const start = startOn ? await settledBox(startOn) : null;
  const header = (await dialog.locator(".dialog-header").boundingBox())!;
  const title = (await dialog.locator(".dialog-title").boundingBox())!;
  const card = (await dialog.locator(".dialog-card").boundingBox())!;
  return {
    grab: start
      ? { x: start.x + start.width / 2, y: start.y + start.height / 2 }
      : { x: title.x + title.width + 24, y: header.y + header.height / 2 },
    cardHeight: card.height,
  };
}

async function swipeClose(dialog: Locator, startOn?: Locator): Promise<void> {
  const { grab, cardHeight } = await geometry(dialog, startOn);
  const finger = await TouchFinger.on(dialog.page());
  await finger.down(grab);
  await finger.move({ x: grab.x, y: grab.y + cardHeight * 0.6 }, 20);
  await finger.hold(150);
  await finger.up();
}

async function dragAndRelease(
  dialog: Locator,
  distance: number,
  holdMs: number,
): Promise<void> {
  const { grab } = await geometry(dialog);
  const finger = await TouchFinger.on(dialog.page());
  await finger.down(grab);
  await finger.move({ x: grab.x, y: grab.y + distance }, 10);
  await finger.hold(holdMs);
  await finger.up();
}

test.describe("swipe to close on mobile", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch swipe is mobile-only");
    await startSession(page);
  });

  test("swiping the header down past the threshold closes the dialog and saves a pending change", async ({
    page,
  }) => {
    const before = (await commitMessages(page)).length;
    const dialog = await openSettings(page);
    await chooseAccent(page, "Teal");
    await swipeClose(dialog);
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await commitMessages(page)).length, {
        timeout: 10_000,
      })
      .toBe(before + 1);
    expect((await commitMessages(page)).join("\n")).toContain(
      "Commitnote-Settings: accentColor",
    );
  });

  test("a long swipe starting on the title closes the dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    await swipeClose(dialog, dialog.locator(".dialog-title"));
    await expect(dialog).toHaveCount(0);
  });

  test("a long swipe starting on the grab handle closes the dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    await swipeClose(dialog, dialog.getByTestId("dialog-grab-handle"));
    await expect(dialog).toHaveCount(0);
  });

  test("a short slow drag snaps back and leaves the dialog open and usable", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    await dragAndRelease(dialog, 40, 200);
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-swipe", /.*/);
    await chooseAccent(page, "Teal");
    await expect(dialog.getByRole("radio", { name: "Teal" })).toBeChecked();
  });

  test("a fast short flick closes the dialog", async ({ page }) => {
    const dialog = await openSettings(page);
    const { grab } = await geometry(dialog);
    const finger = await TouchFinger.on(page);
    const start = Date.now() / 1000;
    await finger.down(grab, start);
    for (let i = 1; i <= 3; i++) {
      await finger.move(
        { x: grab.x, y: grab.y + 20 * i },
        1,
        start + (16 * i) / 1000,
      );
    }
    await finger.up(start + 48 / 1000);
    await expect(dialog).toHaveCount(0);
  });

  test("swiping up on the header does not close the dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const { grab } = await geometry(dialog);
    const finger = await TouchFinger.on(page);
    await finger.down(grab);
    await finger.move({ x: grab.x, y: grab.y - 120 }, 12);
    await finger.hold(100);
    await finger.up();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-swipe", /.*/);
  });

  test("scrolling the dialog body with touch does not close the dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const body = (await dialog.locator(".dialog-body").boundingBox())!;
    const centre = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
    const down = await TouchFinger.on(page);
    await down.down(centre);
    await down.move({ x: centre.x, y: centre.y - 150 }, 12);
    await down.hold(100);
    await down.up();
    const up = await TouchFinger.on(page);
    await up.down(centre);
    await up.move({ x: centre.x, y: centre.y + 250 }, 20);
    await up.hold(100);
    await up.up();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-swipe", /.*/);
  });

  test("a fullscreen dialog closes by swipe", async ({ page }) => {
    await moveToTrash(page, "Welcome");
    const dialog = await openTrash(page);
    await swipeClose(dialog);
    await expect(dialog).toHaveCount(0);
  });

  test("a dialog without a header close button closes by swipe", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "New folder" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Folder name")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
    await swipeClose(dialog);
    await expect(dialog).toHaveCount(0);
  });

  test("swiping a stacked confirmation closes only the confirmation", async ({
    page,
  }) => {
    await moveToTrash(page, "Welcome");
    const trash = await openTrash(page);
    await page.getByTestId("empty-trash").click();
    const confirm = page.getByRole("dialog", { name: "Empty trash?" });
    await expect(confirm).toBeVisible();
    await swipeClose(confirm);
    await expect(confirm).toHaveCount(0);
    await expect(trash).toBeVisible();
  });

  test("tapping the header close button closes the dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toHaveCount(0);
  });

  test("the grab handle is visible", async ({ page }) => {
    const dialog = await openSettings(page);
    await expect(dialog.getByTestId("dialog-grab-handle")).toBeVisible();
  });

  test("swiping closes the dialog when reduced motion is preferred", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openSettings(page);
    await swipeClose(dialog);
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("dialog grab handle on desktop", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop-only");
    await startSession(page);
  });

  test("no grab handle is shown", async ({ page }) => {
    const dialog = await openSettings(page);
    await expect(dialog.getByTestId("dialog-grab-handle")).toBeHidden();
  });
});
