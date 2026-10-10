import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { TouchFinger, fakeForge, logOut, openNotes } from "./helpers";
import { installFakeKeyboard, setKeyboard, settledBox } from "./helpers/dialog";
import { openSettings } from "./helpers/settings";
import { moveToTrash, openTrash } from "./helpers/tree";

interface Frame {
  readonly exists: boolean;
  readonly open: boolean;
  readonly exiting: boolean;
  readonly top: number;
  readonly backdrop: number;
  readonly animations: number;
}

type RecorderWindow = Window & { __frames?: Frame[]; __recording?: boolean };

async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as RecorderWindow;
    w.__frames = [];
    w.__recording = true;
    const sample = () => {
      if (!w.__recording) return;
      const dialogs = document.querySelectorAll("dialog");
      const dialog = dialogs[dialogs.length - 1];
      const card = dialog?.querySelector(".dialog-card");
      w.__frames!.push({
        exists: dialog !== undefined && card !== null,
        open: dialog?.open ?? false,
        exiting: dialog?.hasAttribute("data-exiting") ?? false,
        top: card?.getBoundingClientRect().top ?? 0,
        backdrop: dialog
          ? Number(getComputedStyle(dialog, "::backdrop").opacity)
          : 0,
        animations: dialog?.getAnimations({ subtree: true }).length ?? 0,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function stopRecording(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as RecorderWindow;
    w.__recording = false;
    return w.__frames!.filter((frame) => frame.exists);
  });
}

interface ScreenFrame {
  readonly shell: boolean;
  readonly incoming: boolean;
  readonly incomingTop: number;
  readonly dialog: boolean;
}

type ScreenRecorderWindow = Window & {
  __screenFrames?: ScreenFrame[];
  __screenRecording?: boolean;
};

async function startScreenRecording(page: Page, incoming: string): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as ScreenRecorderWindow;
    w.__screenFrames = [];
    w.__screenRecording = true;
    const sample = () => {
      if (!w.__screenRecording) return;
      const screen = document.querySelector(selector);
      w.__screenFrames!.push({
        shell: document.querySelector(".shell") !== null,
        incoming: screen !== null,
        incomingTop: screen?.getBoundingClientRect().top ?? 0,
        dialog: document.querySelector("dialog") !== null,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, incoming);
}

async function stopScreenRecording(page: Page): Promise<ScreenFrame[]> {
  return page.evaluate(() => {
    const w = window as ScreenRecorderWindow;
    w.__screenRecording = false;
    return w.__screenFrames!;
  });
}

async function incomingFrameCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as ScreenRecorderWindow).__screenFrames!.filter((frame) => frame.incoming)
        .length,
  );
}

function expectCleanSwap(frames: readonly ScreenFrame[]): void {
  expect(frames.some((frame) => frame.shell)).toBe(true);
  expect(frames.some((frame) => frame.shell && frame.incoming)).toBe(false);
  const incoming = frames.filter((frame) => frame.incoming);
  expect(incoming.length).toBeGreaterThan(0);
  for (const frame of incoming) {
    expect(Math.abs(frame.incomingTop - incoming[0]!.incomingTop)).toBeLessThanOrEqual(1);
  }
}

async function backdropOpacity(dialog: Locator): Promise<number> {
  return dialog.evaluate((el) => Number(getComputedStyle(el, "::backdrop").opacity));
}

async function focusIsOutsideDialogs(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.activeElement !== document.body &&
      document.activeElement?.closest("dialog") === null,
  );
}

async function expectSlidUpOnOpen(
  page: Page,
  open: () => Promise<Locator>,
): Promise<Frame[]> {
  await startRecording(page);
  const dialog = await open();
  const card = await settledBox(dialog.locator(".dialog-card"));
  const frames = await stopRecording(page);
  const opened = frames.filter((frame) => frame.open);
  expect(opened.length).toBeGreaterThan(2);
  expect(opened[0]!.top).toBeGreaterThanOrEqual(card.y + card.height / 2);
  expect(opened.at(-1)!.top).toBeLessThanOrEqual(card.y + 1);
  return opened;
}

test.describe("sheet slide with motion", { tag: "@mobile-only" }, () => {
  test.use({ reducedMotion: "no-preference" });

  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("the settings sheet slides up and its backdrop fades in", async ({ page }) => {
    const opened = await expectSlidUpOnOpen(page, () => openSettings(page));
    const settledBackdrop = await backdropOpacity(page.getByRole("dialog"));
    expect(opened[0]!.backdrop).toBeLessThan(settledBackdrop);
    expect(settledBackdrop).toBeGreaterThan(0);
  });

  test("closing slides the sheet down while focus returns and the dialog stays out of the way", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const rest = await settledBox(dialog.locator(".dialog-card"));
    await startRecording(page);
    await dialog.getByRole("button", { name: "Close" }).click();

    await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 100 });
    expect(await focusIsOutsideDialogs(page)).toBe(true);

    await expect(page.locator("dialog")).toHaveCount(0);
    const exiting = (await stopRecording(page)).filter((frame) => frame.exiting);
    expect(exiting.length).toBeGreaterThan(2);
    exiting.forEach((frame, index) => {
      expect(frame.open).toBe(false);
      if (index > 0) {
        expect(frame.top).toBeGreaterThanOrEqual(exiting[index - 1]!.top - 0.5);
      }
    });
    expect(exiting.at(-1)!.top).toBeGreaterThan(rest.y + 10);
  });

  test("the fullscreen trash dialog slides up", async ({ page }) => {
    await moveToTrash(page, "Welcome");
    await expectSlidUpOnOpen(page, () => openTrash(page));
  });

  test("a swipe close never replays an exit", async ({ page }) => {
    const dialog = await openSettings(page);
    const card = await settledBox(dialog.locator(".dialog-card"));
    const header = (await dialog.locator(".dialog-header").boundingBox())!;
    const title = (await dialog.locator(".dialog-title").boundingBox())!;
    const grab = { x: title.x + title.width + 24, y: header.y + header.height / 2 };

    const finger = await TouchFinger.on(page);
    await finger.down(grab);
    await finger.move({ x: grab.x, y: grab.y + card.height * 0.6 }, 20);
    await startRecording(page);
    finger.hold(150);
    await finger.up();

    await expect(page.locator("dialog")).toHaveCount(0);
    const frames = await stopRecording(page);
    expect(frames.some((frame) => frame.exiting)).toBe(false);
    frames.forEach((frame, index) => {
      if (index > 0) {
        expect(frame.top).toBeGreaterThanOrEqual(frames[index - 1]!.top - 0.5);
      }
    });
  });

  test("reopening a prop-driven dialog during the exit leaves exactly one usable dialog", async ({
    page,
  }) => {
    await moveToTrash(page, "Welcome");
    const dialog = await openTrash(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 100 });

    const reopened = await openTrash(page);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(reopened).not.toHaveAttribute("data-exiting");
    await reopened.getByRole("button", { name: "Close" }).focus();
    await expect(reopened.getByRole("button", { name: "Close" })).toBeFocused();

    await settledBox(reopened.locator(".dialog-card"));
    await expect(page.locator("dialog")).toHaveCount(1);
  });

  test("reopening settings during the exit leaves exactly one usable dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 100 });

    const reopened = await openSettings(page);
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(reopened).not.toHaveAttribute("data-exiting");
    await settledBox(reopened.locator(".dialog-card"));
    await expect(page.locator("dialog")).toHaveCount(1);
  });

  test("logging out swaps to the login screen without showing both screens", async ({
    page,
  }) => {
    await startScreenRecording(page, ".login-shell");
    await logOut(page);
    await expect(page.locator(".login-shell")).toBeVisible();
    await expect(page.locator(".shell")).toHaveCount(0);
    await expect.poll(() => incomingFrameCount(page)).toBeGreaterThan(5);
    expectCleanSwap(await stopScreenRecording(page));
  });

  test("a key change behind the settings sheet swaps screens without showing both", async ({
    page,
  }) => {
    await page.clock.install();
    await page.clock.runFor(16_000);
    await openSettings(page);
    await fakeForge(page).changeRepoKey();
    await startScreenRecording(page, ".key-changed-shell");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await expect(page.getByRole("heading", { name: "Passphrase changed" })).toBeVisible();
    await expect.poll(() => incomingFrameCount(page)).toBeGreaterThan(5);
    const frames = await stopScreenRecording(page);
    expectCleanSwap(frames);
    frames.forEach((frame) => expect(frame.dialog).toBe(frame.shell));
  });
});

test.describe("sheet above the keyboard with motion", { tag: "@mobile-only" }, () => {
  test.use({ reducedMotion: "no-preference" });

  test("the settled sheet sits on top of the keyboard", async ({ page }) => {
    await installFakeKeyboard(page);
    await openNotes(page);
    await setKeyboard(page, 300);
    await page.getByRole("button", { name: "New folder" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Folder name")).toBeVisible();
    const card = await settledBox(dialog.locator(".dialog-card"));
    const height = await page.evaluate(() => window.innerHeight);
    expect(Math.abs(card.y + card.height - (height - 300))).toBeLessThanOrEqual(1);
  });
});

test.describe("sheet without motion", { tag: "@mobile-only" }, () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("opening and closing run no animation and remove the dialog at once", async ({
    page,
  }) => {
    await startRecording(page);
    const dialog = await openSettings(page);
    const rest = await settledBox(dialog.locator(".dialog-card"));
    const opened = (await stopRecording(page)).filter((frame) => frame.open);
    expect(opened.length).toBeGreaterThan(1);
    for (const frame of opened) {
      const atRest = Math.abs(frame.top - rest.y) <= 1;
      const beforeFirstPaint = frame.top >= rest.y + rest.height / 2;
      expect(atRest || beforeFirstPaint).toBe(true);
    }
    expect(opened.at(-1)!.animations).toBe(0);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog")).toHaveCount(0, { timeout: 100 });
  });
});

test.describe("dialog close on desktop with motion", () => {
  test.skip(({ isMobile }) => isMobile, "desktop layout only");
  test.use({ reducedMotion: "no-preference" });

  test("the dialog stays centred and closing removes it at once", async ({ page }) => {
    await openNotes(page);
    const dialog = await openSettings(page);
    const card = await settledBox(dialog.locator(".dialog-card"));
    const width = await page.evaluate(() => window.innerWidth);
    expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThanOrEqual(1);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog")).toHaveCount(0, { timeout: 100 });
  });
});
