import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { expectTree, logIn } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const PASSPHRASE = "sample notes repo passphrase";
const FAKE_FORGE_BANNER = "Test mode: fake forge, no network";
const SERIF_STACK =
  'ui-serif, Charter, "Bitstream Charter", "Iowan Old Style", Georgia, Cambria, "Noto Serif", "Times New Roman", serif';
const LITERATA_STACK = `"Literata Variable", ${SERIF_STACK}`;
const MONO_STACK = "var(--font-mono)";

function printView(page: Page): Locator {
  return page.locator(".print-view");
}

function editor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Note editor" });
}

function settingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "Settings" });
}

async function openWelcome(page: Page): Promise<void> {
  await page.getByRole("treeitem", { name: "Welcome", exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More commands" }).click();
  await page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  await expect(settingsDialog(page)).toBeVisible();
}

async function chooseOption(
  page: Page,
  section: string,
  name: string,
): Promise<void> {
  await settingsDialog(page)
    .getByRole("radiogroup", { name: section })
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) })
    .click();
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);
}

function expectedFamily(page: Page, stack: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.fontFamily = value;
    document.body.appendChild(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return family;
  }, stack);
}

function computedFamily(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).fontFamily);
}

async function expectFamily(page: Page, locator: Locator, stack: string) {
  const expected = await expectedFamily(page, stack);
  await expect.poll(() => computedFamily(locator)).toBe(expected);
}

function dispatchPrintEvent(
  page: Page,
  type: "beforeprint" | "afterprint",
): Promise<void> {
  return page.evaluate((name) => {
    window.dispatchEvent(new Event(name));
  }, type);
}

async function printPreview(page: Page): Promise<void> {
  await page.emulateMedia({ media: "print" });
  await dispatchPrintEvent(page, "beforeprint");
}

// A synthetic paste inserts the whole text in one transaction; typing 400 lines key by key is slow.
async function paste(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test.describe("with a note", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await logIn(page, { repo: NOTES_REPO, passphrase: PASSPHRASE });
    await expectTree(page);
  });

  test("hides the app and shows the rendered note under print media", { tag: "@mobile" }, async ({
    page,
  }) => {
    await openWelcome(page);
    await expect(printView(page)).toBeHidden();

    await page.emulateMedia({ media: "print" });
    const view = printView(page);
    await expect(view).toBeVisible();
    await expect(page.getByRole("treeitem").first()).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Note name" })).toBeHidden();
    await expect(editor(page)).toBeHidden();
    await expect(page.getByText(FAKE_FORGE_BANNER)).toBeHidden();

    await expect(view.locator("h1")).toHaveText("Welcome");
    await expect(view.locator("header.print-title")).toHaveCount(0);
    await expect(view.locator("strong")).toHaveText("notes");
    await expect(view.locator("s")).toHaveText("strikethrough");
    await expect(view.locator("pre code")).toHaveText('console.log("hello");');
    const link = view.locator('a[href="https://github.com/example/commitnote"]');
    await expect(link).toHaveText("commitnote project");
    await expect(link.locator("+ .print-url")).toHaveText(
      " (https://github.com/example/commitnote)",
    );
    await expect(view.locator('li[data-task="done"]')).toHaveCount(1);
    await expect(view.locator('li[data-task="open"]')).toHaveCount(1);
    await expect(view.locator("table th").first()).toHaveText("Column A");
    await expect(view.locator("blockquote")).toHaveCount(1);

    const text = (await view.textContent()) ?? "";
    for (const raw of ["**", "~~", "```", "[x]"]) {
      expect(text).not.toContain(raw);
    }
  });

  test("a long note prints every line", async ({ page }) => {
    await openWelcome(page);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    const lines = Array.from({ length: 400 }, (_, i) => `Line ${i + 1}`);
    await paste(page, `\n${lines.join("\n")}`);
    await page.keyboard.press("ControlOrMeta+Home");
    await expect(editor(page)).toContainText("Welcome");
    // The editor only renders visible lines; a printed page must not depend on that.
    await expect(editor(page)).not.toContainText("Line 400");

    await printPreview(page);
    const view = printView(page);
    await expect(view).toContainText("Line 1");
    await expect(view).toContainText("Line 400");
  });

  test("an unsaved edit prints immediately", async ({ page }) => {
    await openWelcome(page);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" printed now");
    await dispatchPrintEvent(page, "beforeprint");
    await expect(printView(page)).toContainText("printed now", {
      timeout: 200,
    });
  });

  test("the document title is the note name only while printing", async ({
    page,
  }) => {
    await openWelcome(page);
    await dispatchPrintEvent(page, "beforeprint");
    await expect(page).toHaveTitle("Welcome");
    await dispatchPrintEvent(page, "afterprint");
    await expect(page).toHaveTitle("commitnote");
  });

  test("shows the note name when the note does not start with it", async ({
    page,
  }) => {
    await openWelcome(page);
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.type("# Hello");

    await printPreview(page);
    const title = printView(page).locator("header.print-title");
    await expect(title).toHaveText("Welcome");
    await expect(title.locator("+ .print-body h1")).toHaveText("Hello");
  });

  test("prints an empty page when no note is open", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    // An empty print view has no height, so Playwright's visibility check would call it hidden.
    await expect(printView(page)).not.toHaveCSS("display", "none");
    await expect(printView(page)).toHaveText("");
    await expect(printView(page).locator(".print-body")).toBeEmpty();
    await expect(page.getByText("Select a note to read it, or")).toBeHidden();
    await expect(page.getByRole("tree", { name: "Notes" })).toBeHidden();
  });

  test("prints the note while a dialog is open", { tag: "@mobile" }, async ({ page }, testInfo) => {
    await openWelcome(page);
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Back to notes" }).click();
    }
    await openSettings(page);

    await printPreview(page);
    await expect(settingsDialog(page)).toBeHidden();
    await expect(printView(page)).toBeVisible();
    await expect(printView(page)).toContainText("Welcome");
  });

  test("dark mode prints black on white", async ({ page }) => {
    await openWelcome(page);
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    await dispatchPrintEvent(page, "beforeprint");

    const view = printView(page);
    await expect(view).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(view.locator("a").first()).toHaveCSS("color", "rgb(0, 0, 0)");
  });

  test("uses the chosen note font for text and monospace for code", async ({
    page,
  }) => {
    await openSettings(page);
    await chooseOption(page, "Note font", "Literata");
    await closeSettings(page);
    await openWelcome(page);

    await printPreview(page);
    const view = printView(page);
    await expectFamily(page, view.locator("p").first(), LITERATA_STACK);
    await expectFamily(page, view.locator("pre code"), MONO_STACK);
    await expectFamily(page, view.locator("p code").first(), MONO_STACK);
  });

  test("produces a PDF", async ({ page }) => {
    await openWelcome(page);
    const pdf = await page.pdf();
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

test.describe("without logging in", () => {
  test("the login screen prints an empty page", async ({ page }) => {
    await page.goto("/");
    await page.emulateMedia({ media: "print" });
    await expect(printView(page)).toHaveText("");
    await expect(printView(page).locator(".print-body")).toBeEmpty();
    await expect(page.getByLabel("Access token")).toBeHidden();
    await expect(page.getByText(FAKE_FORGE_BANNER)).toBeHidden();
  });
});
