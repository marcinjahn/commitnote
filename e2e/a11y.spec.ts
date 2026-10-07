import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  KEY_DERIVATION_TIMEOUT,
  chooseRepository,
  fakeForge,
  openNotes,
  showTree,
} from "./helpers";
import { expectNoA11yViolations } from "./helpers/a11y";
import { openDataSecurityAction, openSettings } from "./helpers/settings";
import { createLink, shareDialog } from "./helpers/sharing";
import {
  moveToTrash,
  openHistory,
  openTrash,
  openWelcome,
  treeItem,
} from "./helpers/tree";

const SEARCH_REPO = "https://github.com/sample/search";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function openCommandsMenu(page: Page): Promise<void> {
  await showTree(page);
  await page.getByRole("button", { name: "More commands" }).click();
  await expect(page.getByRole("menu", { name: "Commands" })).toBeVisible();
}

async function searchFor(page: Page, query: string): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
  await openNotes(page, { repo: SEARCH_REPO });
  await page.getByRole("button", { name: "Search notes" }).click();
  await page.getByRole("combobox", { name: "Search notes" }).fill(query);
}

async function createPasswordLinkViewer(page: Page): Promise<Page> {
  await openNotes(page);
  await openWelcome(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await createLink(page, { password: "open sesame" });
  const viewer = await page.context().newPage();
  await viewer.emulateMedia({ reducedMotion: "reduce" });
  await viewer.goto(link);
  await expect(
    viewer.getByRole("heading", {
      name: "This note is protected with a password",
    }),
  ).toBeVisible();
  return viewer;
}

test("login @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expectNoA11yViolations(page, "login");
});

test("login-error", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter the access token.");
  await expectNoA11yViolations(page, "login-error");
});

test("onboarding", async ({ page }) => {
  await page.goto("/");
  await chooseRepository(page, { repo: "https://github.com/sample/empty" });
  await expect(page.getByLabel("Create passphrase")).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expectNoA11yViolations(page, "onboarding");
});

test("tree @mobile", async ({ page }) => {
  await openNotes(page);
  await expectNoA11yViolations(page, "tree");
});

test("note @mobile", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await expectNoA11yViolations(page, "note");
});

test("commands-menu @mobile", async ({ page }) => {
  await openNotes(page);
  await openCommandsMenu(page);
  await expectNoA11yViolations(page, "commands-menu");
});

test("row-menu", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Actions for Welcome" }).click();
  await expect(
    page.getByRole("menu", { name: "Actions for Welcome" }),
  ).toBeVisible();
  await expectNoA11yViolations(page, "row-menu");
});

test("error-toast", async ({ page }) => {
  await openNotes(page);
  await fakeForge(page).failNext("getHead", "Network");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("group", { name: "Error" })).toBeVisible();
  await expectNoA11yViolations(page, "error-toast");
});

test("settings @mobile", async ({ page }) => {
  await openNotes(page);
  await showTree(page);
  await openSettings(page);
  await expectNoA11yViolations(page, "settings");
});

test("change-passphrase", async ({ page }) => {
  await openNotes(page);
  await openDataSecurityAction(page, "Change passphrase");
  await expectNoA11yViolations(page, "change-passphrase");
});

test("search-results", async ({ page }) => {
  await searchFor(page, "road");
  await expect(
    page
      .getByRole("listbox", { name: "Search results" })
      .getByRole("option")
      .first(),
  ).toBeVisible();
  await expectNoA11yViolations(page, "search-results");
});

test("search-no-matches", async ({ page }) => {
  await searchFor(page, "zzqx");
  await expect(page.getByText("No notes match")).toBeVisible();
  await expectNoA11yViolations(page, "search-no-matches");
});

test("history", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);
  await openHistory(page);
  await expectNoA11yViolations(page, "history");
});

async function openShareDialog(page: Page): Promise<void> {
  await treeItem(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share…" }).click();
  await expect(shareDialog(page)).toBeVisible();
}

test("share-dialog", async ({ page }) => {
  await openNotes(page);
  await openShareDialog(page);
  await expectNoA11yViolations(page, "share-dialog");
});

test("share-link-created", async ({ page }) => {
  await openNotes(page);
  await openShareDialog(page);
  await createLink(page);
  await expectNoA11yViolations(page, "share-link-created");
});

test("shared-links", async ({ page }) => {
  await openNotes(page);
  await openShareDialog(page);
  await createLink(page);
  await page.keyboard.press("Escape");
  await expect(shareDialog(page)).toHaveCount(0);
  await openCommandsMenu(page);
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Shared links" })
    .click();
  await expect(page.getByRole("dialog", { name: "Shared links" })).toBeVisible();
  await expectNoA11yViolations(page, "shared-links");
});

test("trash", async ({ page }) => {
  await openNotes(page);
  await moveToTrash(page, "Welcome");
  await openTrash(page);
  await expectNoA11yViolations(page, "trash");
});

test("viewer-password", async ({ page }) => {
  const viewer = await createPasswordLinkViewer(page);
  await expectNoA11yViolations(viewer, "viewer-password");
});

test("viewer-unlocked @mobile", async ({ page }) => {
  const viewer = await createPasswordLinkViewer(page);
  await viewer.getByRole("textbox", { name: "Password" }).fill("open sesame");
  await viewer.getByRole("button", { name: "Unlock" }).click();
  await expect(
    viewer.getByRole("heading", { name: "Welcome", level: 1 }).first(),
  ).toBeVisible({ timeout: KEY_DERIVATION_TIMEOUT });
  await expectNoA11yViolations(viewer, "viewer-unlocked");
});

test.describe("in Square corners", () => {
  test.use({ cornerStyle: "square" });

  test("square-commands-menu", async ({ page }) => {
    await openNotes(page);
    await openCommandsMenu(page);
    await expectNoA11yViolations(page, "square-commands-menu");
  });
});
