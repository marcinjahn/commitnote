import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fakeForge, openNotes } from "./helpers";
import { treeItem } from "./helpers/tree";

interface Facts {
  material: boolean;
  menuRadius: string;
  toastRadius: string;
  texture: boolean;
}

const PLATFORMS = {
  mac: { material: true, menuRadius: "10px", toastRadius: "12px", texture: false },
  ios: { material: true, menuRadius: "14px", toastRadius: "16px", texture: false },
  windows: { material: true, menuRadius: "8px", toastRadius: "8px", texture: true },
  android: { material: false, menuRadius: "4px", toastRadius: "4px", texture: false },
  linux: { material: false, menuRadius: "0px", toastRadius: "0px", texture: false },
  other: { material: false, menuRadius: "0px", toastRadius: "0px", texture: false },
} satisfies Record<string, Facts>;

function surfaceStyle(surface: Locator) {
  return surface.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      filter: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
      radius: style.borderRadius,
      image: style.backgroundImage,
    };
  });
}

async function expectSurface(
  surface: Locator,
  facts: Facts,
  radius: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const style = await surfaceStyle(surface);
      return {
        material: style.filter !== "none",
        radius: style.radius,
        texture: style.image.startsWith("url("),
        flat: style.image === "none",
      };
    })
    .toEqual({
      material: facts.material,
      radius,
      texture: facts.texture,
      flat: !facts.texture,
    });
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

for (const [platform, facts] of Object.entries(PLATFORMS) as [
  keyof typeof PLATFORMS,
  Facts,
][]) {
  test.describe(`${platform} surfaces`, () => {
    test.use({ platform });

    test("menu and toast take the platform material, shape and texture", async ({
      page,
    }) => {
      await openNotes(page);
      await expect(page.locator("html")).toHaveAttribute("data-platform", platform);

      await rowMenuTrigger(page).click();
      const menu = rowMenu(page);
      await expect(menu).toBeVisible();
      await expectSurface(menu, facts, facts.menuRadius);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);

      const toast = await showErrorToast(page);
      await expectSurface(toast, facts, facts.toastRadius);
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
    });
  });
}

test.describe("mac menu placement", () => {
  test.use({ platform: "mac" });

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
          right: Math.abs(menuBox.x + menuBox.width - (triggerBox.x + triggerBox.width)) <= 1,
          top: Math.abs(menuBox.y - (triggerBox.y + triggerBox.height + 4)) <= 1,
        };
      })
      .toEqual({ right: true, top: true });
  });
});

test.describe("mac with reduced transparency", () => {
  test.use({ platform: "mac" });

  test("menu and toast drop material and texture but keep their shape", async ({ page }) => {
    await emulateReducedTransparency(page);
    await openNotes(page);

    await treeItem(page, "Welcome").click({ button: "right" });
    const menu = rowMenu(page);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("data-anchor", "point");
    await expectSurface(menu, { ...PLATFORMS.mac, material: false }, "10px");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    const toast = await showErrorToast(page);
    await expectSurface(toast, { ...PLATFORMS.mac, material: false }, "12px");
  });
});

test.describe("detected platform", () => {
  test.use({ platform: "detect" });

  test("resolves to a known platform", async ({ page }) => {
    await openNotes(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-platform",
      /^(mac|windows|linux|ios|android|other)$/,
    );
  });
});

test.describe("ios touch targets", () => {
  test.use({ platform: "ios" });

  test("menu items are at least 44px tall", { tag: "@mobile-only" }, async ({ page }) => {
    await openNotes(page);
    await rowMenuTrigger(page).tap();
    const menu = rowMenu(page);
    await expect(menu).toBeVisible();
    await expect.poll(() => surfaceStyle(menu).then((s) => s.radius)).toBe("14px");

    const items = menu.getByRole("menuitem");
    expect(await items.count()).toBeGreaterThan(0);
    await expect
      .poll(() =>
        items.evaluateAll((els) =>
          Math.min(...els.map((el) => el.getBoundingClientRect().height)),
        ),
      )
      .toBeGreaterThanOrEqual(44);
  });
});

async function overflowPastRoundedCorners(menu: Locator, target: Locator): Promise<number> {
  const handle = await menu.elementHandle();
  return target.evaluate((el, menuEl) => {
    if (!(menuEl instanceof HTMLElement)) throw new Error("menu is not an element");
    const menuStyle = getComputedStyle(menuEl);
    const border = parseFloat(menuStyle.borderTopWidth);
    const outer = menuEl.getBoundingClientRect();
    const box = {
      left: outer.left + border,
      top: outer.top + border,
      right: outer.right - border,
      bottom: outer.bottom - border,
    };
    const clipRadius = Math.max(0, parseFloat(menuStyle.borderTopLeftRadius) - border);
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
        worst = Math.max(worst, Math.hypot(cx - mx, cy - my) + radius - clipRadius);
      }
    }
    return worst;
  }, handle);
}

for (const platform of ["ios", "mac"] as const) {
  test.describe(`${platform} menu corners`, () => {
    test.use({ platform });

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

        await expect.poll(() => overflowPastRoundedCorners(menu, red)).toBeLessThanOrEqual(0.5);
        await expect
          .poll(() => overflowPastRoundedCorners(menu, red.locator(".swatch-circle")))
          .toBeLessThanOrEqual(0.5);

        await page.keyboard.press("End");
        const last = menu.getByRole("menuitem").last();
        await expect(last).toBeFocused();
        await expect.poll(() => overflowPastRoundedCorners(menu, last)).toBeLessThanOrEqual(0.5);
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
  });
}
