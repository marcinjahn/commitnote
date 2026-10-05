import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { TouchFinger, type TouchPoint, openNotes, fakeForge } from "./helpers";
import { chooseAccent, openSettings } from "./helpers/settings";
import { moveToTrash, openHistory, openTrash } from "./helpers/tree";


async function openWelcomeHistory(page: Page): Promise<Locator> {
  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  return openHistory(page);
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TopRegion {
  readonly handle: Box;
  readonly card: Box;
  readonly title: Box;
}

interface Geometry {
  readonly grab: TouchPoint;
  readonly cardHeight: number;
}

async function settledBox(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate(
        (el) =>
          (el.closest("dialog") ?? el)
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
  return (await target.boundingBox())!;
}

async function geometry(dialog: Locator): Promise<Geometry> {
  const card = await settledBox(dialog.locator(".dialog-card"));
  const header = (await dialog.locator(".dialog-header").boundingBox())!;
  const title = (await dialog.locator(".dialog-title").boundingBox())!;
  return {
    grab: { x: title.x + title.width + 24, y: header.y + header.height / 2 },
    cardHeight: card.height,
  };
}

async function swipeClose(dialog: Locator): Promise<void> {
  const { grab, cardHeight } = await geometry(dialog);
  await swipeDownFrom(dialog, grab, cardHeight);
}

async function swipeDownFrom(
  dialog: Locator,
  grab: TouchPoint,
  cardHeight: number,
): Promise<void> {
  const finger = await TouchFinger.on(dialog.page());
  await finger.down(grab);
  await finger.move({ x: grab.x, y: grab.y + cardHeight * 0.6 }, 20);
  finger.hold(150);
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
  finger.hold(holdMs);
  await finger.up();
}

test.describe("swipe to close on mobile", { tag: "@mobile-only" }, () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("swiping the header down past the threshold closes the dialog and saves a pending change", async ({
    page,
  }) => {
    const before = await fakeForge(page).commitCount();
    const dialog = await openSettings(page);
    await chooseAccent(page, "Teal");
    await swipeClose(dialog);
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => await fakeForge(page).commitCount(), {
        timeout: 10_000,
      })
      .toBe(before + 1);
    expect((await fakeForge(page).commitMessages()).join("\n")).toContain(
      "Commitnote-Settings: accentColor",
    );
  });

  const topRegionStarts: ReadonlyArray<{
    readonly name: string;
    readonly at: (parts: TopRegion) => TouchPoint;
  }> = [
    {
      name: "just below the card's top border",
      at: ({ handle, card }) => ({ x: handle.x + handle.width / 2, y: card.y + 2 }),
    },
    {
      name: "the grab handle's centre",
      at: ({ handle }) => ({
        x: handle.x + handle.width / 2,
        y: handle.y + handle.height / 2,
      }),
    },
    {
      name: "the gap between the grab handle and the title",
      at: ({ handle, title }) => ({
        x: handle.x + handle.width / 2,
        y: (handle.y + handle.height + title.y) / 2,
      }),
    },
    {
      name: "the title",
      at: ({ title }) => ({
        x: title.x + title.width / 2,
        y: title.y + title.height / 2,
      }),
    },
    {
      name: "the card's left edge beside the grab handle",
      at: ({ handle, card }) => ({
        x: card.x + 4,
        y: handle.y + handle.height / 2,
      }),
    },
    {
      name: "halfway between the grab handle and the card's right edge",
      at: ({ handle, card }) => ({
        x: (handle.x + handle.width + card.x + card.width) / 2,
        y: handle.y + handle.height / 2,
      }),
    },
    {
      name: "the card's left edge beside the title",
      at: ({ title, card }) => ({
        x: card.x + 4,
        y: title.y + title.height / 2,
      }),
    },
  ];

  const handleDialogs: ReadonlyArray<{
    readonly kind: string;
    readonly prepare?: (page: Page) => Promise<void>;
    readonly open: (page: Page) => Promise<Locator>;
  }> = [
    { kind: "sheet", open: openSettings },
    {
      kind: "fullscreen",
      prepare: (page) => moveToTrash(page, "Welcome"),
      open: openTrash,
    },
    {
      kind: "wide",
      prepare: (page) =>
        page.getByRole("treeitem", { name: "Welcome", exact: true }).click(),
      open: openHistory,
    },
  ];

  for (const { kind, prepare, open } of handleDialogs) {
    test(`a ${kind} dialog closes by a touch swipe from every start point in the top region`, async ({
      page,
    }) => {
      await prepare?.(page);
      for (const start of topRegionStarts) {
        await test.step(`starting at ${start.name}`, async () => {
          const dialog = await open(page);
          const card = await settledBox(dialog.locator(".dialog-card"));
          const handle = (await dialog.getByTestId("dialog-grab-handle").boundingBox())!;
          const title = (await dialog.locator(".dialog-title").boundingBox())!;
          const at = start.at({ handle, card, title });
          expect(
            await page.evaluate(
              ({ x, y }) =>
                document.elementFromPoint(x, y)?.closest(".dialog-card") !== null,
              at,
            ),
          ).toBe(true);
          await swipeDownFrom(dialog, at, card.height);
          await expect(dialog).toHaveCount(0);
        });
      }
    });
  }

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
    finger.hold(100);
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
    down.hold(100);
    await down.up();
    const up = await TouchFinger.on(page);
    await up.down(centre);
    await up.move({ x: centre.x, y: centre.y + 250 }, 20);
    up.hold(100);
    await up.up();
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-swipe", /.*/);
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

  test("tapping the top edge of the header close button closes the dialog", async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const button = await settledBox(dialog.getByRole("button", { name: "Close" }));
    await page.touchscreen.tap(button.x + button.width / 2, button.y + 2);
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
    let dialog = await openSettings(page);
    await test.step("swiping the header", async () => {
      await swipeClose(dialog);
      await expect(dialog).toHaveCount(0);
    });
    await test.step("swiping from the grab handle", async () => {
      dialog = await openSettings(page);
      const card = await settledBox(dialog.locator(".dialog-card"));
      const handle = (await dialog.getByTestId("dialog-grab-handle").boundingBox())!;
      await swipeDownFrom(
        dialog,
        { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
        card.height,
      );
      await expect(dialog).toHaveCount(0);
    });
  });
});

test.describe("dialog grab handle on desktop", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("no grab handle is shown", async ({ page }) => {
    const dialog = await openSettings(page);
    await expect(dialog.getByTestId("dialog-grab-handle")).toBeHidden();
  });

  for (const { kind, open } of [
    { kind: "sheet", open: openSettings },
    { kind: "wide", open: openWelcomeHistory },
  ]) {
    test(`the ${kind} dialog header sits inside the card padding`, async ({
      page,
    }) => {
      const dialog = await open(page);
      const card = await settledBox(dialog.locator(".dialog-card"));
      const header = (await dialog.locator(".dialog-header").boundingBox())!;
      const inset = await dialog.locator(".dialog-card").evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          top: parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
          left: parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        };
      });
      expect(header.y - card.y).toBeCloseTo(inset.top, 0);
      expect(header.x - card.x).toBeCloseTo(inset.left, 0);
    });
  }
});
