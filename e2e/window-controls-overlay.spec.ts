import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fakeForge, openNotes } from "./helpers";
import { createLink } from "./helpers/sharing";
import { emulateStandalone } from "./helpers/install";
import { openWelcome } from "./helpers/tree";
import {
  controlsRects,
  emulateWindowControlsOverlay,
  type OverlayPlatform,
} from "./helpers/window-controls-overlay";

const INTERACTIVE =
  'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function appRegions(locator: Locator): Promise<string[]> {
  return locator.evaluateAll(
    (elements, selector) =>
      elements
        .flatMap((element) => [
          ...(element.matches(selector) ? [element] : []),
          ...element.querySelectorAll(selector),
        ])
        .filter((element) => element.checkVisibility({ visibilityProperty: true }))
        .map((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region")),
    INTERACTIVE,
  );
}

async function interactiveBoxes(page: Page, scope = "body"): Promise<Box[]> {
  return page.evaluate(
    ({ scope, selector }) =>
      [...document.querySelectorAll(scope)]
        .flatMap((root) => [...root.querySelectorAll(selector)])
        .filter(
          (element) =>
            element.checkVisibility({ visibilityProperty: true }) &&
            getComputedStyle(element).clip !== "rect(0px, 0px, 0px, 0px)",
        )
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map(({ x, y, width, height }) => ({ x, y, width, height })),
    { scope, selector: INTERACTIVE },
  );
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function expectClearOfControls(
  page: Page,
  platform: OverlayPlatform,
  scope = "body",
): Promise<void> {
  const width = page.viewportSize()!.width;
  const controls = controlsRects(platform, width);
  const boxes = await interactiveBoxes(page, scope);
  expect(boxes.length).toBeGreaterThan(0);
  const overlapping = boxes.filter((box) =>
    controls.some((rect) => intersects(box, rect)),
  );
  expect(overlapping).toEqual([]);
}

async function expectDragHeader(header: Locator): Promise<void> {
  const box = await header.boundingBox();
  expect(box!.y).toBe(0);
  expect(box!.height).toBeGreaterThanOrEqual(33);
  await expect(header).toHaveCSS("-webkit-app-region", "drag");
  const regions = await appRegions(header);
  expect(regions.length).toBeGreaterThan(0);
  expect(regions.every((region) => region === "no-drag")).toBe(true);
}

async function expectDragScreen(
  page: Page,
  platform: OverlayPlatform,
): Promise<void> {
  const topLevel = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().top === 0 &&
          getComputedStyle(element).getPropertyValue("-webkit-app-region") ===
            "drag",
      )
      .map((element) => element.tagName),
  );
  expect(topLevel.length).toBeGreaterThan(0);
  const draggable = await page.evaluate((selector) => {
    const region = (element: Element): string =>
      getComputedStyle(element).getPropertyValue("-webkit-app-region");
    const insideDragRegion = (element: Element): boolean => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (region(node) === "drag") return true;
      }
      return false;
    };
    return [...document.querySelectorAll(selector)]
      .filter((element) => element.checkVisibility({ visibilityProperty: true }))
      .filter(
        (element) =>
          region(element) === "drag" ||
          (region(element) !== "no-drag" && insideDragRegion(element)),
      )
      .map((element) => element.outerHTML.slice(0, 80));
  }, INTERACTIVE);
  expect(draggable).toEqual([]);
  await expectClearOfControls(page, platform);
  const controls = controlsRects(platform, page.viewportSize()!.width);
  const wordmarks = await page
    .locator(".wordmark")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON() as Box),
    );
  expect(wordmarks.length).toBeGreaterThan(0);
  for (const wordmark of wordmarks) {
    for (const rect of controls) expect(intersects(wordmark, rect)).toBe(false);
  }
}

test.describe("window controls overlay", () => {
  test("Windows: headers are drag regions with no-drag controls clear of the window controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "windows" });

    await expectDragHeader(page.locator(".tree-header"));
    await expectDragHeader(page.locator(".note-header"));
    await expect(page.locator(".sidebar-resize-handle")).toHaveCSS(
      "-webkit-app-region",
      "no-drag",
    );
    await expectClearOfControls(page, "windows");
  });

  test("Windows: the empty note pane starts below the title bar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await emulateWindowControlsOverlay(page, { platform: "windows" });

    const placeholder = page.locator(".note-placeholder");
    await expect(placeholder).toBeVisible();
    const box = (await placeholder.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(33);
    const button = placeholder.getByRole("button", { name: /new note/i });
    await expect(button).toBeVisible();
    const buttonBox = (await button.boundingBox())!;
    for (const rect of controlsRects("windows", 1280)) {
      expect(intersects(box, rect)).toBe(false);
      expect(intersects(buttonBox, rect)).toBe(false);
    }
    await expectClearOfControls(page, "windows");
  });

  test("macOS: the tree header clears the window controls on the left", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    const area = await emulateWindowControlsOverlay(page, { platform: "macos" });

    const header = page.locator(".tree-header");
    await expectDragHeader(header);
    await expect
      .poll(
        async () =>
          (await header.locator(".wordmark").first().boundingBox())!.x,
      )
      .toBeGreaterThanOrEqual(area.x);
    const controls = await interactiveBoxes(page, ".tree-header");
    expect(controls.length).toBeGreaterThan(0);
    for (const box of controls) expect(box.x).toBeGreaterThanOrEqual(area.x);
    await expectClearOfControls(page, "macos");
  });

  test("macOS: every tree-header control fits inside the default sidebar and is clickable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "macos" });

    const sidebar = (await page.locator(".sidebar").boundingBox())!;
    const controls = await interactiveBoxes(page, ".tree-header");
    expect(controls.length).toBeGreaterThan(0);
    for (const box of controls) {
      expect(box.x).toBeGreaterThanOrEqual(sidebar.x);
      expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
    }

    await page.getByRole("button", { name: "More commands" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
  });

  test("macOS: the sidebar edge follows the pointer from the default width and the separator announces the shown width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "macos" });

    const sidebar = page.locator(".sidebar");
    const handle = page.locator(".sidebar-resize-handle");
    const shown = async () => Math.round((await sidebar.boundingBox())!.width);
    const initial = await shown();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await expect(handle).toHaveAttribute("aria-valuenow", String(initial));
    await expect(handle).toHaveAttribute("aria-valuemin", String(initial));
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();

    expect(Math.abs((await shown()) - (initial + 40))).toBeLessThanOrEqual(1);
    await expect(handle).toHaveAttribute("aria-valuenow", String(await shown()));
  });

  test("macOS: every keyboard step resizes the sidebar and the separator matches", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "macos" });

    const sidebar = page.locator(".sidebar");
    const handle = page.locator(".sidebar-resize-handle");
    const shown = async () => Math.round((await sidebar.boundingBox())!.width);
    await handle.focus();
    const initial = await shown();
    await expect(handle).toHaveAttribute("aria-valuenow", String(initial));

    await page.keyboard.press("ArrowRight");
    await expect.poll(shown).toBeGreaterThan(initial);
    await expect(handle).toHaveAttribute("aria-valuenow", String(await shown()));

    await page.keyboard.press("ArrowLeft");
    await expect.poll(shown).toBe(initial);
    await expect(handle).toHaveAttribute("aria-valuenow", String(initial));
  });

  test("macOS: the note pane keeps its minimum width at 800px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "macos" });
    await page.locator(".sidebar-resize-handle").focus();

    const pane = (await page.locator(".note-pane").boundingBox())!;
    expect(pane.width).toBeGreaterThanOrEqual(400);
  });

  test("Windows: the sidebar still resizes 1:1 from 300px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "windows" });

    const sidebar = page.locator(".sidebar");
    const handle = page.locator(".sidebar-resize-handle");
    expect((await sidebar.boundingBox())!.width).toBe(300);
    await expect(handle).toHaveAttribute("aria-valuenow", "300");

    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();

    expect(Math.abs((await sidebar.boundingBox())!.width - 340)).toBeLessThanOrEqual(1);
    await expect(handle).toHaveAttribute("aria-valuenow", "340");
  });

  test("macOS: the focused skip link stays clear of the window controls and is no-drag", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openNotes(page);
    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "macos" });

    const skipLink = page.locator(".skip-link");
    await skipLink.focus();
    const box = (await skipLink.boundingBox())!;
    expect(box.width).toBeGreaterThan(1);
    for (const rect of controlsRects("macos", 1280)) {
      expect(intersects(box, rect)).toBe(false);
    }
    await expect(skipLink).toHaveCSS("-webkit-app-region", "no-drag");
  });

  test("Windows, narrow: both views keep their controls clear of the window controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await openNotes(page);
    await emulateWindowControlsOverlay(page, { platform: "windows" });

    await expectDragHeader(page.locator(".tree-header"));
    await expectClearOfControls(page, "windows", ".tree-header");

    await openWelcome(page);
    await emulateWindowControlsOverlay(page, { platform: "windows" });
    await expectDragHeader(page.locator(".note-header"));
    await expectClearOfControls(page, "windows", ".note-header");
  });

  for (const platform of ["windows", "macos"] as const) {
    test(`${platform}: the login screen is draggable and clear of the window controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await expect(page.getByLabel("Access token")).toBeVisible();
      await emulateWindowControlsOverlay(page, { platform });

      await expectDragScreen(page, platform);
    });

    test(`${platform}: the shared note viewer is draggable and clear of the window controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await openNotes(page);
      await openWelcome(page);
      await page.getByRole("button", { name: "Share", exact: true }).click();
      const link = await createLink(page);

      const viewer = await page.context().newPage();
      await viewer.setViewportSize({ width: 1280, height: 800 });
      await viewer.goto(link);
      await expect(
        viewer.getByRole("button", { name: "Copy text" }),
      ).toBeVisible();
      await emulateWindowControlsOverlay(viewer, { platform });

      await expectDragScreen(viewer, platform);
    });

    test(`${platform}: the key-changed screen is draggable and clear of the window controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await openNotes(page);
      await fakeForge(page).changeRepoKey();
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(
        page.getByRole("heading", { name: "Passphrase changed" }),
      ).toBeVisible();
      await emulateWindowControlsOverlay(page, { platform });

      await expectDragScreen(page, platform);
    });
  }

  for (const mode of ["browser tab", "standalone"] as const) {
    test(`overlay rules stay inactive in ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      if (mode === "standalone") await emulateStandalone(page);
      await openNotes(page);
      await openWelcome(page);

      for (const [selector, side] of [
        [".tree-header", "padding-left"],
        [".note-header", "padding-right"],
      ] as const) {
        const header = page.locator(selector);
        await expect(header).toHaveCSS("-webkit-app-region", "none");
        await expect(header).toHaveCSS(side, "16px");
      }
    });
  }
});
