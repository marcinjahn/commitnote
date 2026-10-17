import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { fakeForge, openNotes, TouchFinger, type TouchPoint } from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

const MOBILE_ONLY = { tag: "@mobile-only" } as const;

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

function indicator(page: Page): Locator {
  return page.locator(".pull-indicator");
}

function refreshButton(page: Page): Locator {
  return page.getByRole("button", { name: "Refresh" });
}

function wordmarkPoint(page: Page): Promise<TouchPoint> {
  return centerOf(page.locator(".tree-header .wordmark"));
}

async function pointIn(locator: Locator): Promise<TouchPoint> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + 40, y: box.y + box.height / 2 };
}

async function centerOf(locator: Locator): Promise<TouchPoint> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pull(
  page: Page,
  from: TouchPoint,
  by: number,
): Promise<TouchFinger> {
  const finger = await TouchFinger.on(page);
  await finger.down(from);
  await finger.move({ x: from.x, y: from.y + by });
  return finger;
}

async function expectSettled(page: Page): Promise<void> {
  await expect(indicator(page)).toHaveAttribute("data-phase", "idle");
  await expect(indicator(page)).toBeHidden();
}

async function refreshManually(page: Page): Promise<void> {
  await expect(refreshButton(page)).toBeEnabled();
  await refreshButton(page).click();
  await expect(refreshButton(page)).toHaveAttribute("data-feedback", "success");
}

async function fullPull(page: Page): Promise<void> {
  const finger = await pull(page, await wordmarkPoint(page), 200);
  await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
  await expect(indicator(page)).toBeVisible();
  await finger.up();
}

test(
  "a full pull on the top bar refreshes once",
  MOBILE_ONLY,
  async ({ page }) => {
    const forge = fakeForge(page);
    const before = await forge.getHeadCount();

    await fullPull(page);

    await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
    await expect(refreshButton(page)).toHaveAttribute(
      "data-feedback",
      "success",
    );
    await expect(
      page.getByRole("status").filter({ hasText: "Refreshed" }),
    ).toHaveCount(1);
    await expectSettled(page);

    await expect(refreshButton(page)).not.toHaveAttribute("data-feedback");
    await refreshManually(page);
    await expect.poll(() => forge.getHeadCount()).toBe(before + 2);
  },
);

test("a short pull does nothing", MOBILE_ONLY, async ({ page }) => {
  const forge = fakeForge(page);
  const before = await forge.getHeadCount();

  const finger = await pull(page, await wordmarkPoint(page), 40);
  await expect(indicator(page)).toHaveAttribute("data-phase", "pulling");
  await finger.up();
  await expectSettled(page);

  await refreshManually(page);
  await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
});

test("a swipe on the tree list never pulls", MOBILE_ONLY, async ({ page }) => {
  const forge = fakeForge(page);
  const before = await forge.getHeadCount();

  const finger = await pull(
    page,
    await pointIn(treeItem(page, "Welcome")),
    200,
  );
  await expect(indicator(page)).toHaveAttribute("data-phase", "idle");
  await expect(indicator(page)).toBeHidden();
  await finger.up();

  await refreshManually(page);
  await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
});

test(
  "a tap on Refresh in the top bar still refreshes",
  MOBILE_ONLY,
  async ({ page }) => {
    const forge = fakeForge(page);
    const before = await forge.getHeadCount();
    await expect(refreshButton(page)).toBeEnabled();

    const finger = await TouchFinger.on(page);
    await finger.down(await centerOf(refreshButton(page)));
    await finger.up();

    await expect(refreshButton(page)).toHaveAttribute(
      "data-feedback",
      "success",
    );
    await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
    await expectSettled(page);
  },
);

test("the note view has no pull gesture", MOBILE_ONLY, async ({ page }) => {
  const forge = fakeForge(page);
  await openWelcome(page);
  const before = await forge.getHeadCount();
  const header = page.locator(".note-header");
  const box = (await header.boundingBox())!;

  const finger = await pull(
    page,
    { x: box.x + box.width / 2, y: box.y + 4 },
    200,
  );
  await expect(indicator(page)).toHaveAttribute("data-phase", "idle");
  await finger.up();
  expect(await forge.getHeadCount()).toBe(before);

  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(treeItem(page, "Welcome")).toBeVisible();
  await refreshManually(page);
  await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test(
    "the indicator neither rotates nor spins",
    MOBILE_ONLY,
    async ({ page }) => {
      const forge = fakeForge(page);
      const before = await forge.getHeadCount();
      await indicator(page).evaluate((el) => {
        const seen = window as unknown as {
          pullRefreshing?: { running: number };
        };
        new MutationObserver(() => {
          if (el.dataset.phase !== "refreshing" || seen.pullRefreshing) return;
          const running = el
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length;
          seen.pullRefreshing = { running };
        }).observe(el, { attributes: true, attributeFilter: ["data-phase"] });
      });

      const finger = await pull(page, await wordmarkPoint(page), 200);
      await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
      const transforms = await indicator(page).evaluate((el) => ({
        indicator: getComputedStyle(el).transform,
        icon: getComputedStyle(el.querySelector("svg")!).transform,
      }));
      expect(transforms.indicator).toMatch(/^matrix\(1, 0, 0, 1, /);
      expect(transforms.icon).toBe("none");
      await finger.up();

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { pullRefreshing?: { running: number } })
                .pullRefreshing,
          ),
        )
        .toEqual({ running: 0 });
      await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
    },
  );
});
