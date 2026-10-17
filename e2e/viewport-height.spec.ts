import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes } from "./helpers";
import { createLink } from "./helpers/sharing";
import { openWelcome } from "./helpers/tree";

async function verticalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.scrollingElement!.scrollHeight - window.innerHeight,
  );
}

async function expectNoVerticalOverflow(page: Page): Promise<void> {
  await expect.poll(() => verticalOverflow(page)).toBeLessThanOrEqual(0);
}

test.describe("viewport height", { tag: "@mobile" }, () => {
  test("login screen does not overflow the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Access token")).toBeVisible();
    await expectNoVerticalOverflow(page);
  });

  test("notes tree fills the space below the banner", async ({ page }) => {
    await openNotes(page);
    await expectNoVerticalOverflow(page);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.abs(
            document.querySelector(".shell")!.getBoundingClientRect().bottom -
              window.innerHeight,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.abs(
            document.querySelector(".shell")!.getBoundingClientRect().top -
              document
                .querySelector(".test-mode-banner")!
                .getBoundingClientRect().bottom,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
  });

  test("note view does not overflow the page", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    await expectNoVerticalOverflow(page);
  });

  test("shared note viewer prompt does not overflow the page", async ({ page }) => {
    await openNotes(page);
    await openWelcome(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const link = await createLink(page, { password: "open sesame" });
    const viewer = await page.context().newPage();
    await viewer.goto(link);
    await expect(
      viewer.getByRole("heading", {
        name: "This note is protected with a password",
      }),
    ).toBeVisible();
    await expectNoVerticalOverflow(viewer);
  });
});
