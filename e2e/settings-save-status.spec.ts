import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openNotes, fakeForge } from "./helpers";
import { chooseAccent, openSettings, settingsDialog } from "./helpers/settings";


function dialogStatus(page: Page, text: string) {
  return settingsDialog(page).getByText(text, { exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNotes(page);
});

test("choosing the option that is already selected shows no save status", async ({
  page,
}) => {
  await openSettings(page);

  await chooseAccent(page, "System");

  await expect(settingsDialog(page).locator(".settings-save-status")).toHaveText("");
});

test.describe("with GitHub-like forge latency", () => {
  test.use({ forgeLatency: "github" });

  test("the Settings dialog shows a change waiting, saving, then briefly saved, and a change while Saved ends saved again", async ({
    page,
  }) => {
    await openSettings(page);

    await chooseAccent(page, "Teal");

    await expect(dialogStatus(page, "Waiting to save")).toBeVisible();
    await expect(dialogStatus(page, "Saving")).toBeVisible({ timeout: 3_000 });
    await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
    await expect(settingsDialog(page).locator(".settings-save-status")).toContainText(
      "Settings saved",
    );

    await chooseAccent(page, "Red");

    await expect(dialogStatus(page, "Waiting to save")).toBeVisible();
    await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
    await expect(settingsDialog(page).locator(".settings-save-status")).toHaveText("", {
      timeout: 4_000,
    });
  });

  test("after closing Settings mid-save, the sidebar shows the save until it lands and reopens Settings", async ({
    page,
  }) => {
    const indicator = page.getByRole("button", { name: "Saving settings" });
    await expect(indicator).toHaveCount(0);

    await openSettings(page);
    await chooseAccent(page, "Teal");
    await page.keyboard.press("Escape");
    await expect(settingsDialog(page)).toHaveCount(0);

    await expect(indicator).toBeVisible();
    await indicator.click();
    await expect(settingsDialog(page)).toBeVisible();
    await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await expect(
      page.getByRole("button", { name: /^(Saving settings|Settings waiting)/ }),
    ).toHaveCount(0);
  });

  test("Retry after a failed settings save saves it at once", async ({ page }) => {
    await fakeForge(page).failNext("commit", "Server");
    await openSettings(page);
    await chooseAccent(page, "Teal");
    await expect(dialogStatus(page, "Saving failed")).toBeVisible({
      timeout: 10_000,
    });

    await settingsDialog(page).getByRole("button", { name: "Retry" }).click();

    // Automatic retry only comes after a 5 s back-off.
    await expect(dialogStatus(page, "Saving")).toBeVisible({ timeout: 1_000 });
    await expect(dialogStatus(page, "Saved")).toBeVisible({ timeout: 10_000 });
    await expect(
      settingsDialog(page).getByRole("button", { name: "Retry" }),
    ).toHaveCount(0);
  });
});

test("a failed settings save stays visible in the sidebar after closing Settings", async ({
  page,
}) => {
  await fakeForge(page).failNext("commit", "Server");
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("button", { name: /^Saving settings failed, will retry/ }),
  ).toBeVisible({ timeout: 10_000 });
});

test("on the narrow layout a failed settings save shows only the indicator in the sidebar footer", { tag: "@mobile-only" }, async ({
  page,
}) => {
  await fakeForge(page).failNext("commit", "Server");
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await page.keyboard.press("Escape");

  const footer = page.locator(".sidebar-footer");
  const indicator = footer.getByRole("button", {
    name: /^Saving settings failed, will retry/,
  });
  await expect(indicator).toBeVisible({ timeout: 10_000 });
  await expect(footer.locator(".repo-link")).toHaveCount(0);
  await expect(footer.getByRole("button", { name: "Log out" })).toHaveCount(0);

  const box = await indicator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
});
