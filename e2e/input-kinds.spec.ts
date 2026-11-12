import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  SAMPLE,
  chooseRepository,
  continueWithToken,
  openNotes,
} from "./helpers";
import { expectInputKind } from "./helpers/input-kind";
import { openDataSecurityAction, openSettings, enableVimMode } from "./helpers/settings";
import {
  createLink,
  openSharedLinks,
  shareAction,
  shareDialog,
} from "./helpers/sharing";
import { openWelcome } from "./helpers/tree";

const noteEditor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });

async function clickIntoFirstParagraph(page: Page): Promise<void> {
  await noteEditor(page)
    .locator(".cm-line")
    .filter({ hasText: "This is your" })
    .click();
}

test("login fields keep verbatim input", async ({ page }) => {
  await page.goto("./");

  await expectInputKind(page.getByLabel("Access token"), "verbatim");
  await continueWithToken(page);
  await chooseRepository(page, { repo: SAMPLE.repo });
  await expectInputKind(
    page.getByLabel("Passphrase", { exact: true }),
    "verbatim",
  );

  await page
    .getByLabel("Repository", { exact: true })
    .selectOption({ label: "sample/empty" });
  await expectInputKind(page.getByLabel("Create passphrase"), "verbatim");
  await expectInputKind(page.getByLabel("Repeat passphrase"), "verbatim");
});

test("notes app fields choose their input kind", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);

  await expectInputKind(page.getByRole("textbox", { name: "Note name" }), "prose");

  await clickIntoFirstParagraph(page);
  await expectInputKind(noteEditor(page), "prose");
  await expect(noteEditor(page)).toHaveAttribute("writingsuggestions", "false");
  await expect(noteEditor(page)).toHaveAttribute("translate", "no");

  await page.getByRole("button", { name: "New folder" }).click();
  await expectInputKind(page.getByLabel("Folder name"), "prose");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Folder name")).toHaveCount(0);

  await page.getByRole("button", { name: "Search notes" }).click();
  await expectInputKind(
    page.getByRole("combobox", { name: "Search notes" }),
    "verbatim",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Search notes" })).toHaveCount(0);

  const settings = await openSettings(page);
  await expectInputKind(settings.getByLabel("Device name"), "prose");
  await openDataSecurityAction(page, "Change passphrase");
  const change = page.getByRole("dialog", { name: "Change passphrase" });
  await expectInputKind(change.getByLabel("Current passphrase"), "verbatim");
  await expectInputKind(
    change.getByLabel("New passphrase", { exact: true }),
    "verbatim",
  );
  await expectInputKind(change.getByLabel("Repeat new passphrase"), "verbatim");
  await page.keyboard.press("Escape");
  await expect(change).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  await enableVimMode(page);
  await clickIntoFirstParagraph(page);
  await page.keyboard.press(":");
  await expectInputKind(
    page.getByRole("textbox", { name: "Vim command" }),
    "verbatim",
  );
});

test("sharing fields choose their input kind", async ({ page }) => {
  await openNotes(page);
  await openWelcome(page);

  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = shareDialog(page);
  await expectInputKind(
    dialog.getByRole("textbox", { name: "Name (optional)" }),
    "prose",
  );
  await expectInputKind(
    dialog.getByRole("textbox", { name: "Password (optional)" }),
    "verbatim",
  );

  const link = await createLink(page, {
    password: "open sesame",
    name: "For Anna",
  });
  await expectInputKind(
    dialog.getByRole("textbox", { name: "Share link" }),
    "verbatim",
  );
  await expectInputKind(
    dialog.getByRole("textbox", { name: "Share password" }),
    "verbatim",
  );

  const viewer = await page.context().newPage();
  await viewer.goto(link);
  await expectInputKind(
    viewer.getByRole("textbox", { name: "Password" }),
    "verbatim",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const list = await openSharedLinks(page);
  await shareAction(list, "For Anna", "Rename…");
  await expectInputKind(
    page
      .getByRole("dialog", { name: "Rename link" })
      .getByRole("textbox", { name: "Name" }),
    "prose",
  );
});
