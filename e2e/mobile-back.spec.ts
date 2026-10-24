import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

const SEARCH_REPO = "https://github.com/sample/search";
const PHONE = { width: 412, height: 839 };

function nameField(page: Page): Locator {
  return page.getByRole("textbox", { name: "Note name" });
}

function backToNotes(page: Page): Locator {
  return page.getByRole("button", { name: "Back to notes" });
}

async function openIdeas(page: Page): Promise<void> {
  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();
  await treeItem(page, "Ideas").click();
  await expect(nameField(page)).toHaveValue("Ideas");
}

type LaunchWindow = {
  __launchConsumer?: (params: { targetURL: string }) => void;
};

async function stubLaunchQueue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(fn: LaunchWindow["__launchConsumer"]) {
          (window as unknown as LaunchWindow).__launchConsumer = fn;
        },
      },
    });
  });
}

async function searchAndOpen(page: Page, query: string, name: RegExp): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as LaunchWindow).__launchConsumer !== undefined,
  );
  await page.evaluate(
    () =>
      (window as unknown as LaunchWindow).__launchConsumer!({
        targetURL: new URL("./?action=search", location.href).href,
      }),
  );
  const palette = page.getByRole("dialog", { name: "Search notes" });
  await palette.getByRole("combobox", { name: "Search notes" }).fill(query);
  await palette.getByRole("option", { name }).first().click();
  await expect(palette).toBeHidden();
}

async function expectTreeShown(page: Page): Promise<void> {
  await expect(page.locator("nav#sidebar")).not.toHaveAttribute("inert");
  await expect(page.locator("main#note-pane")).toHaveAttribute("inert", "");
  await expect.poll(() => new URL(page.url()).hash).toBe("");
}

test(
  "Back to notes returns to the tree in one tap after desktop browsing",
  {
    tag: "@desktop-only",
  },
  async ({ page }) => {
    await openNotes(page, { repo: SEARCH_REPO });
    await openWelcome(page);
    await openIdeas(page);
    await treeItem(page, "Roadmap").click();
    await expect(nameField(page)).toHaveValue("Roadmap");

    await page.setViewportSize(PHONE);
    await backToNotes(page).click();

    await expectTreeShown(page);
    await expect(backToNotes(page)).toBeHidden();
  },
);

test(
  "Back to notes returns to the tree after hopping between notes",
  {
    tag: "@mobile-only",
  },
  async ({ page }) => {
    await stubLaunchQueue(page);
    await openNotes(page, { repo: SEARCH_REPO });
    await openWelcome(page);
    await searchAndOpen(page, "road", /Roadmap/);
    await expect(nameField(page)).toHaveValue("Roadmap");
    await searchAndOpen(page, "ideas", /Ideas/);
    await expect(nameField(page)).toHaveValue("Ideas");

    await backToNotes(page).click();

    await expectTreeShown(page);
    await treeItem(page, "Welcome").click();
    await expect(nameField(page)).toHaveValue("Welcome");
    await backToNotes(page).click();
    await expectTreeShown(page);
  },
);

test(
  "the system Back gesture still steps through the visited notes",
  {
    tag: "@mobile-only",
  },
  async ({ page }) => {
    await stubLaunchQueue(page);
    await openNotes(page, { repo: SEARCH_REPO });
    await openWelcome(page);
    await searchAndOpen(page, "road", /Roadmap/);
    await expect(nameField(page)).toHaveValue("Roadmap");

    await page.goBack();
    await expect(nameField(page)).toHaveValue("Welcome");
    await page.goBack();
    await expectTreeShown(page);
  },
);
