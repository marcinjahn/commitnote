import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openNotes } from "./helpers";
import { openWelcome, treeItem } from "./helpers/tree";

const SEARCH_REPO = "https://github.com/sample/search";

function noteContent(page: Page): Locator {
  return page.locator(".note-content");
}

function scrollTop(page: Page): Promise<number> {
  return noteContent(page).evaluate((el) => el.scrollTop);
}

test.describe("scroll", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page, { repo: SEARCH_REPO });
  });

  test("resets to the top on every note switch", async ({ page }) => {
    await openWelcome(page);
    await page.getByRole("textbox", { name: "Note editor" }).click();
    await page.keyboard.press("ControlOrMeta+End");
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`);
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
    }, `\n${lines.join("\n")}`);

    await noteContent(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Zażółć gęślą jaźń",
    );
    await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
    await expect.poll(() => scrollTop(page)).toBe(0);

    await treeItem(page, "Welcome").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Welcome",
    );
    await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
      "Welcome",
    );
    await expect.poll(() => scrollTop(page)).toBe(0);
  });
});

test.describe("search result focus", () => {
  test.use({ forgeLatency: "github" });

  test("a superseded search selection does not steal focus", async ({ page }) => {
    await page.clock.install();
    await openNotes(page, { repo: SEARCH_REPO });
    await treeItem(page, "Zażółć gęślą jaźń").click();
    const editor = page.getByRole("textbox", { name: "Note editor" });
    await editor.click();
    await page.keyboard.type("edited");
    await treeItem(page, "Welcome").click();
    await expect(page.getByRole("textbox", { name: "Note name" })).toHaveValue(
      "Welcome",
    );

    await page.getByRole("button", { name: "Search notes" }).click();
    const palette = page.getByRole("dialog", { name: "Search notes" });
    const input = palette.getByRole("combobox", { name: "Search notes" });
    await expect(input).toBeFocused();
    await input.fill("reading");
    const target = await treeItem(page, "Zażółć gęślą jaźń").elementHandle();
    await palette.getByRole("option").first().evaluate(async (option, row) => {
      (option as HTMLElement).click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      (row as HTMLElement).click();
    }, target);
    await page.clock.runFor(1000);

    const name = page.getByRole("textbox", { name: "Note name" });
    await expect(name).toHaveValue("Zażółć gęślą jaźń");
    await expect(editor).toBeVisible();
    await expect(editor).not.toBeFocused();
    await expect(name).toHaveValue("Zażółć gęślą jaźń");
  });
});

test.describe("cached note switch", () => {
  test.use({ forgeLatency: "github" });

  test("returning to a viewed note never shows the loading state", async ({
    page,
  }) => {
    await openNotes(page, { repo: SEARCH_REPO });
    const name = page.getByRole("textbox", { name: "Note name" });
    await treeItem(page, "Welcome").click();
    await expect(name).toHaveValue("Welcome");
    await treeItem(page, "Zażółć gęślą jaźń").click();
    await expect(name).toHaveValue("Zażółć gęślą jaźń");
    await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();

    await page.evaluate(() => {
      const record = window as unknown as { contentTexts: string[] };
      record.contentTexts = [];
      new MutationObserver(() => {
        const text = document.querySelector(".note-content")?.textContent ?? "";
        if (record.contentTexts.at(-1) !== text) record.contentTexts.push(text);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await treeItem(page, "Welcome").click();
    await expect(name).toHaveValue("Welcome");
    await expect(page.getByRole("textbox", { name: "Note editor" })).toContainText(
      "Welcome",
    );

    const texts = await page.evaluate(
      () => (window as unknown as { contentTexts: string[] }).contentTexts,
    );
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((text) => text.includes("Loading…"))).toEqual([]);
  });
});
