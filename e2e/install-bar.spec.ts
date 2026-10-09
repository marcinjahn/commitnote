import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { fakeForge, openNotes, showTree, TouchFinger } from "./helpers";
import {
  IPHONE_USER_AGENT,
  announceInstalled,
  emulateStandalone,
  installBar,
  installPromptCalls,
  offerInstallPrompt,
  openCommands,
} from "./helpers/install";
import { createLink } from "./helpers/sharing";
import { openWelcome } from "./helpers/tree";

const MOBILE_ONLY = { tag: "@mobile-only" } as const;
const DISMISSAL_KEY = "commitnote.installBarDismissed";
const PROMPT_COPY = "Install commitnote as an app on this device.";
const IOS_COPY = "Add commitnote to your Home Screen from the Share menu";

async function verticalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.scrollingElement!.scrollHeight - window.innerHeight,
  );
}

async function expectNoVerticalOverflow(page: Page): Promise<void> {
  await expect.poll(() => verticalOverflow(page)).toBeLessThanOrEqual(0);
}

async function expectInstallCommand(page: Page, present: boolean) {
  const menu = await openCommands(page);
  await expect(menu.getByRole("menuitem", { name: "Install app" })).toHaveCount(
    present ? 1 : 0,
  );
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

async function openLogin(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Access token")).toBeVisible();
}

async function expectHowToSteps(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Install commitnote" });
  await expect(dialog).toBeVisible();
  const steps = dialog.getByRole("listitem");
  await expect(steps).toHaveText([
    "Tap the Share button in Safari's toolbar.",
    "Choose Add to Home Screen.",
    "Keep Open as Web App turned on, then tap Add.",
    "Open commitnote from the new icon on your Home Screen.",
  ]);
  await expect(
    dialog.getByText("The installed app keeps its own storage, so you log in again there."),
  ).toBeVisible();
}

function howToDialog(page: Page) {
  return page.getByRole("dialog", { name: "Install commitnote" });
}

test.describe("install bar on Android", MOBILE_ONLY, () => {
  test("offers the install prompt from the tree", async ({ page }) => {
    await openNotes(page);
    await expect(installBar(page)).toHaveCount(0);

    await offerInstallPrompt(page);
    const bar = installBar(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByText(PROMPT_COPY)).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    const headerBox = (await page.locator(".tree-header").boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(headerBox.y + 0.5);
    await expectNoVerticalOverflow(page);

    await bar.getByRole("button", { name: "Install", exact: true }).click();
    await expect.poll(() => installPromptCalls(page)).toBe(1);
    await expect(bar).toHaveCount(0);
    await expectInstallCommand(page, false);
    expect(await installPromptCalls(page)).toBe(1);
  });

  test("remembers a declined install", async ({ page }) => {
    await openNotes(page);
    await offerInstallPrompt(page, "dismissed");
    await installBar(page)
      .getByRole("button", { name: "Install", exact: true })
      .click();
    await expect(installBar(page)).toHaveCount(0);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), DISMISSAL_KEY),
    ).toBe("1");

    await openNotes(page);
    await offerInstallPrompt(page);
    await expect(installBar(page)).toHaveCount(0);
    const menu = await openCommands(page);
    await menu.getByRole("menuitem", { name: "Install app" }).click();
    await expect.poll(() => installPromptCalls(page)).toBe(1);
  });

  test("stays dismissed after the dismiss button", async ({ page }) => {
    await openNotes(page);
    await offerInstallPrompt(page);
    await installBar(page)
      .getByRole("button", { name: "Dismiss install bar" })
      .click();
    await expect(installBar(page)).toHaveCount(0);

    await openNotes(page);
    await offerInstallPrompt(page);
    await expect(installBar(page)).toHaveCount(0);
    await expectInstallCommand(page, true);
  });

  test("disappears once the app is installed", async ({ page }) => {
    await openNotes(page);
    await offerInstallPrompt(page);
    await expect(installBar(page)).toBeVisible();

    await announceInstalled(page);
    await expect(installBar(page)).toHaveCount(0);
    await expectInstallCommand(page, false);
  });

  test("sits above the login screen", async ({ page }) => {
    await openLogin(page);
    await expect(installBar(page)).toHaveCount(0);

    await offerInstallPrompt(page);
    const bar = installBar(page);
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    const headingBox = (await page
      .getByRole("heading", { level: 1 })
      .boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(headingBox.y);
    await expectNoVerticalOverflow(page);

    await bar.getByRole("button", { name: "Install", exact: true }).click();
    await expect.poll(() => installPromptCalls(page)).toBe(1);
  });

  test("is hidden in the note view", async ({ page }) => {
    await openNotes(page);
    await offerInstallPrompt(page);
    await expect(installBar(page)).toBeVisible();

    await openWelcome(page);
    await expect(installBar(page)).toBeHidden();

    await showTree(page);
    await expect(installBar(page)).toBeVisible();
  });

  test("keeps pull to refresh working", async ({ page }) => {
    await openNotes(page);
    await offerInstallPrompt(page);
    await expect(installBar(page)).toBeVisible();
    const forge = fakeForge(page);
    const before = await forge.getHeadCount();

    const box = (await page
      .locator(".tree-header .wordmark")
      .boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const finger = await TouchFinger.on(page);
    await finger.down(from);
    await finger.move({ x: from.x, y: from.y + 200 });
    await expect(page.locator(".pull-indicator")).toHaveAttribute(
      "data-phase",
      "armed",
    );
    await finger.up();

    await expect.poll(() => forge.getHeadCount()).toBe(before + 1);
    await expect(page.locator(".pull-indicator")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    expect(await forge.getHeadCount()).toBe(before + 1);
    await expect(installBar(page)).toBeVisible();
  });

  test("moves the top inset from the tree header to the bar", async ({
    page,
  }) => {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 47, bottom: 0, left: 0, right: 0 },
    });
    await openNotes(page);
    const paddingTop = (selector: string) =>
      page
        .locator(selector)
        .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));

    const headerWithout = await paddingTop(".tree-header");
    expect(headerWithout).toBeGreaterThanOrEqual(47);

    await offerInstallPrompt(page);
    await expect(installBar(page)).toBeVisible();
    expect(await paddingTop(".install-bar")).toBeGreaterThanOrEqual(47);
    await expect
      .poll(() => paddingTop(".tree-header"))
      .toBeLessThan(headerWithout - 40);
  });

  test("does not show in standalone mode", async ({ page }) => {
    await emulateStandalone(page);
    await openNotes(page);
    expect(
      await page.evaluate(
        () => matchMedia("(display-mode: standalone)").matches,
      ),
    ).toBe(true);

    await offerInstallPrompt(page);
    await expect(installBar(page)).toHaveCount(0);
    await expectInstallCommand(page, false);
  });

  test("does not show in the shared note viewer", async ({ page }) => {
    await openNotes(page);
    await page.getByRole("treeitem", { name: "Welcome", exact: true }).click({
      button: "right",
    });
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const link = await createLink(page);

    const viewer = await page.context().newPage();
    await viewer.goto(link);
    await expect(
      viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
    ).toBeVisible();
    await offerInstallPrompt(viewer);
    await expect(installBar(viewer)).toHaveCount(0);
  });
});

test.describe("install bar on iPhone", MOBILE_ONLY, () => {
  test.use({ userAgent: IPHONE_USER_AGENT });

  test("explains how to install from the login screen", async ({ page }) => {
    await openLogin(page);
    const url = page.url();
    const bar = installBar(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByText(IOS_COPY)).toBeVisible();

    await bar.getByRole("button", { name: "How to install" }).click();
    await expectHowToSteps(page);

    await page.goBack();
    await expect(howToDialog(page)).toHaveCount(0);
    await expect(page.getByLabel("Access token")).toBeVisible();
    expect(page.url()).toBe(url);

    await bar.getByRole("button", { name: "How to install" }).click();
    await expectHowToSteps(page);
    await howToDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(howToDialog(page)).toHaveCount(0);
  });

  test("explains how to install from the tree", async ({ page }) => {
    await openNotes(page);
    const bar = installBar(page);
    await expect(bar).toBeVisible();

    await bar.getByRole("button", { name: "How to install" }).click();
    await expectHowToSteps(page);

    await page.goBack();
    await expect(howToDialog(page)).toHaveCount(0);
    await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
  });

  test("offers the instructions in the command menu", async ({ page }) => {
    await openNotes(page);
    const menu = await openCommands(page);
    await menu.getByRole("menuitem", { name: "Install app" }).click();
    await expectHowToSteps(page);
  });
});

test.describe("install on desktop", () => {
  test("offers Install app only in the command menu", async ({ page }) => {
    await openNotes(page);
    await offerInstallPrompt(page);
    await expect(installBar(page)).toHaveCount(0);

    const menu = await openCommands(page);
    await menu.getByRole("menuitem", { name: "Install app" }).click();
    await expect.poll(() => installPromptCalls(page)).toBe(1);
  });

  test("has no Install app command without an install path", async ({
    page,
  }) => {
    await openNotes(page);
    await expectInstallCommand(page, false);
  });
});
