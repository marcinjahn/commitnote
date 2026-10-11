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
