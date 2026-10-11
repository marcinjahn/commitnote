import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  fakeForge,
  openNotes,
  SAMPLE,
  TouchFinger,
  type TouchPoint,
} from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

const MOBILE_ONLY = { tag: "@mobile-only" } as const;

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

function indicator(page: Page): Locator {
  return page.locator(".pull-indicator");
}

function highlightedRows(page: Page): Promise<string[]> {
  return page.locator(".tree-row-container").evaluateAll((rows) =>
    rows
      .filter(
        (row) => getComputedStyle(row).backgroundColor !== "rgba(0, 0, 0, 0)",
      )
      .map((row) => row.querySelector(".tree-row-label")!.textContent!),
  );
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

test("a pull on the tree list refreshes once", MOBILE_ONLY, async ({ page }) => {
  const forge = fakeForge(page);
  const before = await forge.getHeadCount();
  const welcome = treeItem(page, "Welcome");

  const finger = await pull(page, await pointIn(welcome), 200);
  await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
  await finger.up();

  await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
  await expectSettled(page);
  await expect(page.getByRole("textbox", { name: "Note editor" })).toHaveCount(0);
  await expect(highlightedRows(page)).resolves.toEqual([]);
});

test("a swipe on a scrolled tree only scrolls", MOBILE_ONLY, async ({ page }) => {
  await openNotes(page, { repo: "https://github.com/sample/large-tree" });
  const forge = fakeForge(page);
  const scroller = page.locator(".tree-container");
  await scroller.evaluate((el) => {
    el.scrollTop = 400;
  });
  const scrolled = await scroller.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  const before = await forge.getHeadCount();

  const finger = await pull(page, { x: 200, y: 300 }, 150);
  await expect(indicator(page)).toHaveAttribute("data-phase", "idle");
  await finger.up();

  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeLessThan(scrolled);
  expect(await forge.getHeadCount()).toBe(before);
});

test("dragging back up cancels a pull", MOBILE_ONLY, async ({ page }) => {
  const forge = fakeForge(page);
  const before = await forge.getHeadCount();
  const from = await pointIn(treeItem(page, "Welcome"));

  const finger = await pull(page, from, 200);
  await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
  await finger.move({ x: from.x, y: from.y - 30 });
  await expect(indicator(page)).toHaveAttribute("data-phase", "pulling");
  await finger.up();

  await expectSettled(page);
  expect(await forge.getHeadCount()).toBe(before);
});

test("a pull never reloads the page", MOBILE_ONLY, async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __pullSentinel: number }).__pullSentinel = 1;
  });

  const finger = await pull(
    page,
    await pointIn(treeItem(page, "Welcome")),
    200,
  );
  await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
  await finger.up();
  await expectSettled(page);

  expect(
    await page.evaluate(
      () => (window as unknown as { __pullSentinel?: number }).__pullSentinel,
    ),
  ).toBe(1);
});

test.describe("with forge latency", () => {
  test.use({ forgeLatency: "github" });

  test(
    "a row menu opened during a refresh stays anchored to its row",
    MOBILE_ONLY,
    async ({ page }) => {
      const finger = await pull(
        page,
        await pointIn(treeItem(page, "Welcome")),
        200,
      );
      await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
      await finger.up();
      await expect(indicator(page)).toHaveAttribute("data-phase", "refreshing");

      const row = treeItem(page, "Empty folder");
      const press = await TouchFinger.on(page);
      await press.down(await pointIn(row));
      await expect(page.locator("[data-drag-state='dragging']")).toHaveCount(1);
      await press.up();

      const menu = page.getByRole("menu", { name: "Actions for Empty folder" });
      await expect(menu).toBeVisible();
      const rowBox = (await row.boundingBox())!;
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(menuBox.y).toBeLessThan(rowBox.y + rowBox.height);
    },
  );
});

test("the spinner shows for at least half a second", MOBILE_ONLY, async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?fake-forge-session=" + encodeURIComponent(SAMPLE.repo));
  await expect(treeItem(page, "Welcome")).toBeVisible();

  await fullPull(page);
  await expect(indicator(page)).toHaveAttribute("data-phase", "refreshing");
  await page.clock.runFor(400);
  await expect(indicator(page)).toHaveAttribute("data-phase", "refreshing");
  await page.clock.runFor(200);
  await expect(indicator(page)).toHaveAttribute("data-phase", "idle");
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test(
    "the content follows the finger with a rubber band",
    MOBILE_ONLY,
    async ({ page }) => {
      const content = page.locator(".tree-pull-content");
      const offset = () =>
        content.evaluate(
          (el) => new DOMMatrix(getComputedStyle(el).transform).m42,
        );
      const from = await pointIn(treeItem(page, "Welcome"));
      const finger = await TouchFinger.on(page);
      await finger.down(from);

      const offsets: number[] = [];
      for (const travel of [60, 150, 400]) {
        await finger.move({ x: from.x, y: from.y + travel });
        await expect.poll(offset).toBeGreaterThan(offsets.at(-1) ?? 0);
        offsets.push(await offset());
      }
      expect(offsets[0]).toBeGreaterThan(0);
      expect(offsets[2]).toBeLessThan(128);

      await finger.move({ x: from.x, y: from.y - 40 });
      await finger.up();
      await expectSettled(page);
      await expect
        .poll(() => content.evaluate((el) => (el as HTMLElement).style.transform))
        .toBe("");
    },
  );
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
          const running = el.getAnimations({ subtree: true }).filter(
            // The global reduced-motion rule turns every style change into a
            // 0.01 ms transition; only longer ones are visible motion.
            (animation) =>
              animation.playState === "running" &&
              Number(animation.effect?.getComputedTiming().duration) > 1,
          ).length;
          seen.pullRefreshing = { running };
        }).observe(el, { attributes: true, attributeFilter: ["data-phase"] });
      });

      const finger = await pull(page, await wordmarkPoint(page), 200);
      await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
      const transforms = await page.locator(".pull-chip").evaluate((el) => ({
        chip: getComputedStyle(el).transform,
        icon: getComputedStyle(el.querySelector("svg")!).transform,
      }));
      expect(transforms.chip).toMatch(/^matrix\(1, 0, 0, 1, /);
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

  test("the content stays still", MOBILE_ONLY, async ({ page }) => {
    const forge = fakeForge(page);
    const before = await forge.getHeadCount();
    const content = page.locator(".tree-pull-content");

    const finger = await pull(
      page,
      await pointIn(treeItem(page, "Welcome")),
      200,
    );
    await expect(indicator(page)).toHaveAttribute("data-phase", "armed");
    await expect(content).toHaveCSS("transform", "none");
    await finger.up();

    await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
    await expect(content).toHaveCSS("transform", "none");
  });
});
