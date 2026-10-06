import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, fakeForge, openNotes } from "./helpers";
import { chooseAccent, closeSettings, openSettings, rootAccent } from "./helpers/settings";

const TEAL = "rgb(0, 133, 115)";
const REFRESH_FAILURE = "Could not reach GitHub. Showing the last loaded notes.";

async function showLinkCopied(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Actions for Welcome" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share “Welcome”" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

async function showRefreshFailure(page: Page): Promise<void> {
  await fakeForge(page).failNext("getHead", "Network");
  await page.getByRole("button", { name: "Refresh" }).click();
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openNotes(page);
});

test("a success toast carries the accent and follows it", async ({ page }) => {
  await showLinkCopied(page);
  const toast = page.getByRole("group", { name: "Success" }).filter({ hasText: "Link copied" });

  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "success");
  const accent = await rootAccent(page);
  await expect
    .poll(() => toast.evaluate((el) => getComputedStyle(el).boxShadow))
    .toContain(accent);
  expect(await toast.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");

  await toast.hover();
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await closeSettings(page);
  await toast.hover();

  await expect
    .poll(() => toast.evaluate((el) => getComputedStyle(el).boxShadow))
    .toContain(TEAL);
});

test("a failure shows an error toast", async ({ page }) => {
  await showRefreshFailure(page);

  const toast = page.getByRole("group", { name: "Error" }).filter({ hasText: REFRESH_FAILURE });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-tone", "error");
});

test("with reduced motion a dismissed toast leaves without animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await showRefreshFailure(page);
  const toast = page.getByRole("group").filter({ hasText: REFRESH_FAILURE });
  await expect(toast).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector(".toasts")?.getAnimations({ subtree: true }).length ?? 0,
      ),
    )
    .toBe(0);

  const afterOneFrame = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('.toasts button[aria-label="Dismiss notice"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return {
      toasts: document.querySelectorAll(".toasts .toast").length,
      running: (document.querySelector(".toasts")?.getAnimations({ subtree: true }) ?? []).filter(
        (a) => a.playState === "running",
      ).length,
    };
  });

  expect(afterOneFrame).toEqual({ toasts: 0, running: 0 });
});

test("the dismiss control is touch-sized on mobile", { tag: "@mobile-only" }, async ({ page }) => {
  await showRefreshFailure(page);
  const toast = page.getByRole("group").filter({ hasText: REFRESH_FAILURE });
  await expect(toast).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector(".toasts")?.getAnimations({ subtree: true }).length ?? 0,
      ),
    )
    .toBe(0);

  const box = await toast.getByRole("button", { name: "Dismiss notice" }).boundingBox();

  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
});
