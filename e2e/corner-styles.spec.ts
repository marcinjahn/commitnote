import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  KEY_DERIVATION_TIMEOUT,
  SAMPLE,
  chooseRepository,
  expectTree,
  fakeForge,
  flushPendingSaves,
  handOverRepo,
  logOut,
  openNotes,
} from "./helpers";
import { chooseOption, closeSettings, openSettings } from "./helpers/settings";
import { openWelcome, treeItem } from "./helpers/tree";

const CACHE_KEY = "commitnote.cornerStyle";

const STYLES = {
  rounded: { cornerStyle: undefined, attribute: null, radius: "12px", itemHeight: 32, rowRadius: "6px" },
  square: { cornerStyle: "square", attribute: "square", radius: "0px", itemHeight: 44, rowRadius: "0px" },
} as const;

function surfaceStyle(surface: Locator) {
  return surface.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      filter:
        style.backdropFilter ||
        style.getPropertyValue("-webkit-backdrop-filter"),
      radius: style.borderRadius,
      image: style.backgroundImage,
    };
  });
}

async function expectSurface(
  surface: Locator,
  expected: { material: boolean; radius: string },
): Promise<void> {
  await expect
    .poll(async () => {
      const style = await surfaceStyle(surface);
      return {
        material: style.filter !== "none",
        radius: style.radius,
        image: style.image,
      };
    })
    .toEqual({ ...expected, image: "none" });
}

function rowMenuTrigger(page: Page): Locator {
  return page.getByRole("button", { name: "Actions for Welcome" });
}

function rowMenu(page: Page): Locator {
  return page.getByRole("menu", { name: "Actions for Welcome" });
}

async function showErrorToast(page: Page): Promise<Locator> {
  await fakeForge(page).failNext("getHead", "Network");
  await page.getByRole("button", { name: "Refresh" }).click();
  const toast = page.getByRole("group", { name: "Error" });
  await expect(toast).toBeVisible();
  return toast;
}

async function emulateReducedTransparency(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });
}

async function expectToneRail(page: Page, toast: Locator): Promise<void> {
  const errorColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-tone-error)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const firstLayer = await toast.evaluate(
    (el) => getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/)[0],
  );
  expect(firstLayer).toContain("2px 0px 0px 0px inset");
  expect(firstLayer).toContain(errorColor);
}

function expectCorners(page: Page, value: "square" | null): Promise<void> {
  const html = page.locator("html");
  return value === null
    ? expect(html).not.toHaveAttribute("data-corners")
    : expect(html).toHaveAttribute("data-corners", value);
}

function radiusOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).borderRadius);
}

async function pickCorners(
  page: Page,
  name: "Rounded" | "Square",
): Promise<void> {
  await openSettings(page);
  await chooseOption(page, "Corners", name);
  await closeSettings(page);
  await flushPendingSaves(page);
}

function cachedCorners(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), CACHE_KEY);
}

async function shareWelcome(page: Page): Promise<string> {
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share “Welcome”" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  const link = dialog.getByRole("textbox", { name: "Share link" });
  await expect(link).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
  const url = await link.inputValue();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return url;
}

async function openRowMenu(page: Page): Promise<Locator> {
  await rowMenuTrigger(page).click();
  const menu = rowMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

test("rounded is the default and sizes buttons, dialogs and menus", async ({
  page,
}) => {
  await openNotes(page);
  await expectCorners(page, null);
  expect(await radiusOf(page.locator(".button").first())).toBe("6px");

  const dialog = await openSettings(page);
  expect(await radiusOf(dialog.locator(".dialog-card"))).toBe("16px");
  await closeSettings(page);

  const menu = await openRowMenu(page);
  await expectSurface(menu, { material: true, radius: "12px" });
});

test("choosing Square flattens the corners with one settings commit, and Rounded restores them", async ({
  page,
}) => {
  await openNotes(page);
  const before = await fakeForge(page).commitMessages();
  await pickCorners(page, "Square");
  await expectCorners(page, "square");

  await expect
    .poll(async () => {
      const added = (await fakeForge(page).commitMessages()).filter(
        (m) => !before.includes(m),
      );
      return added.map((m) => m.split("\n"));
    })
    .toEqual([expect.arrayContaining(["Commitnote-Settings: cornerStyle"])]);

  expect(await radiusOf(page.locator(".button").first())).toBe("0px");
  const dialog = await openSettings(page);
  expect(await radiusOf(dialog.locator(".dialog-card"))).toBe("0px");
  await closeSettings(page);
  const menu = await openRowMenu(page);
  await expectSurface(menu, { material: true, radius: "0px" });
  await page.keyboard.press("Escape");

  await pickCorners(page, "Rounded");
  await expectCorners(page, null);
  expect(await radiusOf(page.locator(".button").first())).toBe("6px");
});

test("a cached Square is applied before the first paint on reload", async ({
  page,
}) => {
  await openNotes(page);
  await page.evaluate((key) => localStorage.setItem(key, "square"), CACHE_KEY);
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __loadedCorners: string | null }).__loadedCorners =
        document.documentElement.getAttribute("data-corners");
    });
  });
  await page.reload();
  await expectTree(page);
  const recorded = await page.evaluate(
    () =>
      (window as unknown as { __loadedCorners: string | null }).__loadedCorners,
  );
  expect(recorded).toBe("square");
});

test("logging out keeps the corner style", async ({ page }) => {
  await openNotes(page);
  await pickCorners(page, "Square");
  await logOut(page);
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expectCorners(page, "square");
  expect(await cachedCorners(page)).toBe("square");
  expect(await radiusOf(page.locator(".login-card"))).toBe("0px");
});

test("a shared note viewer follows the visitor's cached corner style", async ({
  page,
}) => {
  await openNotes(page);
  const link = await shareWelcome(page);
  await page.evaluate((key) => localStorage.setItem(key, "square"), CACHE_KEY);

  const viewer = await page.context().newPage();
  await viewer.goto(link);
  await expect(viewer).toHaveTitle("Shared note · commitnote");
  await expectCorners(viewer, "square");

  await viewer.evaluate((key) => localStorage.removeItem(key), CACHE_KEY);
  await viewer.reload();
  await expect(viewer).toHaveTitle("Shared note · commitnote");
  await expectCorners(viewer, null);
});

test("login applies the repository's corner style at the passphrase step", async ({
  page,
  openSecondDevice,
}) => {
  await openNotes(page);
  await pickCorners(page, "Square");
  await expect
    .poll(async () =>
      (await fakeForge(page).commitMessages()).some((m) =>
        m.split("\n").includes("Commitnote-Settings: cornerStyle"),
      ),
    )
    .toBe(true);

  const second = await openSecondDevice();
  await handOverRepo(page, second.page);
  await expectCorners(second.page, null);
  await chooseRepository(second.page, { repo: SAMPLE.repo });
  await expect(
    second.page.getByLabel("Passphrase", { exact: true }),
  ).toBeVisible();
  await expectCorners(second.page, "square");
});

test.describe("pinned override", () => {
  test.use({ cornerStyle: "square" });

  test("keeps the pinned style over the synced one and never writes the cache", async ({
    page,
  }) => {
    await openNotes(page);
    const dialog = await openSettings(page);
    await expect(
      dialog
        .getByRole("radiogroup", { name: "Corners" })
        .getByRole("radio", { name: "Rounded", exact: true }),
    ).toBeChecked();
    await closeSettings(page);
    await expectCorners(page, "square");
    expect(await cachedCorners(page)).toBeNull();
  });
});

for (const [name, style] of Object.entries(STYLES)) {
  test.describe(`${name} corners`, () => {
    test.use({ cornerStyle: style.cornerStyle });

    test("menu and toast are glass with the corner style's radius", async ({
      page,
    }) => {
      await openNotes(page);
      if (style.attribute === null) {
        await expect(page.locator("html")).not.toHaveAttribute("data-corners");
      } else {
        await expect(page.locator("html")).toHaveAttribute(
          "data-corners",
          style.attribute,
        );
      }

      await rowMenuTrigger(page).click();
      const menu = rowMenu(page);
      await expect(menu).toBeVisible();
      await expectSurface(menu, { material: true, radius: style.radius });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);

      const toast = await showErrorToast(page);
      await expectSurface(toast, { material: true, radius: style.radius });
      await expectToneRail(page, toast);
    });

    test("reduced transparency drops the glass but keeps the shape", async ({
      page,
    }) => {
      await emulateReducedTransparency(page);
      await openNotes(page);

      await treeItem(page, "Welcome").click({ button: "right" });
      const menu = rowMenu(page);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute("data-anchor", "point");
      await expectSurface(menu, { material: false, radius: style.radius });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);

      const toast = await showErrorToast(page);
      await expectSurface(toast, { material: false, radius: style.radius });
    });

    test("menu items are the style's height on a fine pointer", async ({
      page,
    }) => {
      await openNotes(page);
      const menu = await openRowMenu(page);
      const items = menu.getByRole("menuitem");
      expect(await items.count()).toBeGreaterThan(0);
      await expect
        .poll(() =>
          items.evaluateAll((els) => [
            ...new Set(els.map((el) => el.getBoundingClientRect().height)),
          ]),
        )
        .toEqual([style.itemHeight]);
    });

    test("the selected tree row is inset and rounded only in Rounded", async ({
      page,
    }) => {
      await openNotes(page);
      await openWelcome(page);
      const row = treeItem(page, "Welcome").locator("xpath=..");
      const tree = page.getByRole("tree", { name: "Notes" });
      await expect(row).toHaveClass(/selected/);
      expect(await radiusOf(row)).toBe(style.rowRadius);
      expect(await radiusOf(treeItem(page, "Welcome"))).toBe(style.rowRadius);
      const [rowBox, treeBox] = await Promise.all([
        row.boundingBox(),
        tree.boundingBox(),
      ]);
      if (style.attribute === null) {
        expect(rowBox!.x).toBeGreaterThan(treeBox!.x);
      } else {
        expect(rowBox!.x).toBeCloseTo(treeBox!.x, 0);
      }
    });

    test(
      "menu items are at least 44px tall",
      { tag: "@mobile-only" },
      async ({ page }) => {
        await openNotes(page);
        await rowMenuTrigger(page).tap();
        const menu = rowMenu(page);
        await expect(menu).toBeVisible();
        await expect
          .poll(() => surfaceStyle(menu).then((s) => s.radius))
          .toBe(style.radius);

        const items = menu.getByRole("menuitem");
        expect(await items.count()).toBeGreaterThan(0);
        await expect
          .poll(() =>
            items.evaluateAll((els) =>
              Math.min(...els.map((el) => el.getBoundingClientRect().height)),
            ),
          )
          .toBeGreaterThanOrEqual(44);
      },
    );
  });
}

test("a rect-anchored menu sits under its trigger without the entrance scale", async ({
  page,
}) => {
  await openNotes(page);
  const trigger = page.getByRole("button", { name: "More commands" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Commands" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-anchor", "rect");

  await expect
    .poll(async () => {
      const [triggerBox, menuBox] = await Promise.all([
        trigger.boundingBox(),
        menu.boundingBox(),
      ]);
      if (!triggerBox || !menuBox) return null;
      return {
        right:
          Math.abs(
            menuBox.x + menuBox.width - (triggerBox.x + triggerBox.width),
          ) <= 1,
        top: Math.abs(menuBox.y - (triggerBox.y + triggerBox.height + 4)) <= 1,
      };
    })
    .toEqual({ right: true, top: true });
});

async function overflowPastRoundedCorners(
  menu: Locator,
  target: Locator,
): Promise<number> {
  const handle = await menu.elementHandle();
  return target.evaluate((el, menuEl) => {
    if (!(menuEl instanceof HTMLElement))
      throw new Error("menu is not an element");
    const menuStyle = getComputedStyle(menuEl);
    const border = parseFloat(menuStyle.borderTopWidth);
    const outer = menuEl.getBoundingClientRect();
    const box = {
      left: outer.left + border,
      top: outer.top + border,
      right: outer.right - border,
      bottom: outer.bottom - border,
    };
    const clipRadius = Math.max(
      0,
      parseFloat(menuStyle.borderTopLeftRadius) - border,
    );
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const ring =
      el.matches(":focus-visible") && style.outlineStyle !== "none"
        ? parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
        : 0;
    const grow = Math.max(0, ring);
    const shape = {
      left: rect.left - grow,
      top: rect.top - grow,
      right: rect.right + grow,
      bottom: rect.bottom + grow,
    };
    const corners = [
      { x: -1, y: -1, r: style.borderTopLeftRadius },
      { x: 1, y: -1, r: style.borderTopRightRadius },
      { x: -1, y: 1, r: style.borderBottomLeftRadius },
      { x: 1, y: 1, r: style.borderBottomRightRadius },
    ];
    let worst = Math.max(
      box.left - shape.left,
      box.top - shape.top,
      shape.right - box.right,
      shape.bottom - box.bottom,
    );
    for (const corner of corners) {
      const radius =
        (corner.r.endsWith("%")
          ? (parseFloat(corner.r) / 100) * Math.min(rect.width, rect.height)
          : parseFloat(corner.r)) + grow;
      const cx = (corner.x < 0 ? shape.left : shape.right) - corner.x * radius;
      const cy = (corner.y < 0 ? shape.top : shape.bottom) - corner.y * radius;
      const mx = (corner.x < 0 ? box.left : box.right) - corner.x * clipRadius;
      const my = (corner.y < 0 ? box.top : box.bottom) - corner.y * clipRadius;
      const beyondX = corner.x * (cx - mx) > 0;
      const beyondY = corner.y * (cy - my) > 0;
      if (beyondX && beyondY) {
        worst = Math.max(
          worst,
          Math.hypot(cx - mx, cy - my) + radius - clipRadius,
        );
      }
    }
    return worst;
  }, handle);
}

test(
  "edge rows, their focus rings and the swatch ring stay inside the rounded menu",
  { tag: "@mobile" },
  async ({ page }) => {
    await openNotes(page);
    await rowMenuTrigger(page).click();
    const menu = rowMenu(page);
    await expect(menu).toBeVisible();
    const red = menu.getByRole("menuitemradio", { name: "Red", exact: true });
    await red.click();
    await expect(menu).toHaveCount(0);
    await rowMenuTrigger(page).click();
    await expect(red).toHaveAttribute("aria-checked", "true");

    await expect
      .poll(() => overflowPastRoundedCorners(menu, red))
      .toBeLessThanOrEqual(0.5);
    await expect
      .poll(() =>
        overflowPastRoundedCorners(menu, red.locator(".swatch-circle")),
      )
      .toBeLessThanOrEqual(0.5);

    await page.keyboard.press("End");
    const last = menu.getByRole("menuitem").last();
    await expect(last).toBeFocused();
    await expect
      .poll(() => overflowPastRoundedCorners(menu, last))
      .toBeLessThanOrEqual(0.5);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "More commands" }).click();
    const commands = page.getByRole("menu", { name: "Commands" });
    await expect(commands).toBeVisible();
    await page.keyboard.press("Home");
    const first = commands.getByRole("menuitem").first();
    await expect(first).toBeFocused();
    await expect
      .poll(() => overflowPastRoundedCorners(commands, first))
      .toBeLessThanOrEqual(0.5);
  },
);
