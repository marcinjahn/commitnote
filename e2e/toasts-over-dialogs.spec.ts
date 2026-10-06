import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { KEY_DERIVATION_TIMEOUT, openNotes } from "./helpers";

function shareDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Share “Welcome”" });
}

function toast(page: Page, text: string): Locator {
  return page.getByRole("group").filter({ hasText: text });
}

async function shareWelcome(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Actions for Welcome" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  const dialog = shareDialog(page);
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Share link" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  return dialog;
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openNotes(page);
});

test("a toast over the Share dialog can be dismissed without closing it", { tag: "@mobile" }, async ({
  page,
}) => {
  const dialog = await shareWelcome(page);

  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(toast(page, "Link copied")).toBeVisible();
  await toast(page, "Link copied").getByRole("button", { name: "Dismiss notice" }).click();

  await expect(toast(page, "Link copied")).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

async function shareAction(list: Locator, title: string, item: string): Promise<void> {
  await list.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  await list.getByRole("button", { name: `Share actions for ${title}` }).click();
  await list.page().getByRole("menu", { name: `Share actions for ${title}` }).getByRole("menuitem", { name: item }).click();
}

test("a toast stays clickable while a confirm is stacked over Shared links", async ({ page }) => {
  const share = await shareWelcome(page);
  await page.keyboard.press("Escape");
  await expect(share).toHaveCount(0);
  await page.getByRole("button", { name: "More commands" }).click();
  await page.getByRole("menu", { name: "Commands" }).getByRole("menuitem", { name: "Shared links" }).click();
  const list = page.getByRole("dialog", { name: "Shared links" });

  await shareAction(list, "Welcome", "Copy link");
  await expect(toast(page, "Link copied")).toBeVisible();
  await shareAction(list, "Welcome", "Revoke…");
  const confirm = page.getByRole("dialog", { name: "Revoke link?" });
  await expect(confirm).toBeVisible();
  await toast(page, "Link copied").getByRole("button", { name: "Dismiss notice" }).click();

  await expect(toast(page, "Link copied")).toHaveCount(0);
  await expect(confirm).toBeVisible();
});

test("a toast stays clickable after its dialog closes", async ({ page }) => {
  const dialog = await shareWelcome(page);
  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(toast(page, "Link copied")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await expect(toast(page, "Link copied")).toBeVisible();
  await toast(page, "Link copied").getByRole("button", { name: "Dismiss notice" }).click();
  await expect(toast(page, "Link copied")).toHaveCount(0);
});

test("a toast stays still while a dialog opens or closes over it", async ({ page }) => {
  const dialog = await shareWelcome(page);
  await dialog.getByRole("button", { name: "Copy link", exact: true }).click();
  const copied = toast(page, "Link copied");
  await expect(copied).toBeVisible();
  await expect.poll(() => copied.evaluate((el) => el.getAnimations().length)).toBe(0);
  const settled = await copied.boundingBox();
  await page.evaluate(() => {
    const w = window as unknown as { toastTransitions: string[] };
    w.toastTransitions = [];
    document.addEventListener("transitionrun", (event) => {
      if (event.target instanceof Element && event.target.closest(".toast") !== null) {
        w.toastTransitions.push(event.propertyName);
      }
    });
  });
  const startedTransitions = () =>
    page.evaluate(() => (window as unknown as { toastTransitions: string[] }).toastTransitions);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await copied.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await copied.boundingBox()).toEqual(settled);

  await page.getByRole("button", { name: "Actions for Welcome" }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  await expect(shareDialog(page)).toBeVisible();
  expect(await copied.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await copied.boundingBox()).toEqual(settled);
  expect(await startedTransitions()).toEqual([]);
});
