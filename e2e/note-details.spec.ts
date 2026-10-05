import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { logIn, expectTree, SAMPLE, openNotes, showTree, handOverRepo } from "./helpers";

const T0 = new Date("2026-03-12T10:00:00+01:00");
const DAY_MS = 24 * 60 * 60 * 1000;

test.use({ locale: "en-GB", timezoneId: "Europe/Warsaw" });

async function startSession(page: Page): Promise<void> {
  await page.clock.install({ time: T0 });
  await openNotes(page);
}

function details(page: Page) {
  return page.locator(".note-details");
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Note editor" });
}

function treeItem(page: Page, name: string) {
  return page.getByRole("treeitem", { name, exact: true });
}

async function waitForSynced(page: Page): Promise<void> {
  await expect(page.locator("header.note-header").getByRole("img")).toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

async function typeAndSave(page: Page, text: string): Promise<void> {
  await typeAtEnd(page, text);
  await expect(
    page.locator("header.note-header").getByRole("img"),
  ).toBeVisible();
  await waitForSynced(page);
}

async function wordCount(page: Page): Promise<number> {
  const text = (await details(page).textContent()) ?? "";
  const match = /(\d+) words?/.exec(text);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

test("shows created and updated dates and the word count above the editor", { tag: "@mobile" }, async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();

  const line = details(page);
  await expect(line).toHaveText(
    /^Created 12 Mar 2026 · Updated just now · \d+ words$/,
  );

  const lineBox = await line.boundingBox();
  const editorBox = await editor(page).boundingBox();
  expect(lineBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(editorBox!.y);
  await expect(page.locator(".note-content .note-details")).toHaveCount(1);

  const times = line.locator("span.note-dates time");
  await expect(times).toHaveCount(2);
  for (const time of await times.all()) {
    const datetime = await time.getAttribute("datetime");
    expect(new Date(datetime!).toDateString()).toBe(T0.toDateString());
    expect(await time.getAttribute("title")).toBeTruthy();
  }
});

test("typing updates the word count before the note is saved", async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText(/\d+ words/);
  const before = await wordCount(page);

  await typeAtEnd(page, " alpha beta");

  await expect(details(page)).toContainText(`${before + 2} words`);
});

test("the updated time follows the clock and resets after a save", async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Updated just now");

  await page.clock.fastForward(3 * DAY_MS);
  await expect(details(page)).toContainText("Updated 3 days ago");

  await typeAndSave(page, " more");

  await expect(details(page)).toContainText("Updated just now", {
    timeout: 15_000,
  });
  await expect(details(page)).toContainText("Created 12 Mar 2026");
});

test("saving an edit keeps the cached dates until they refresh", async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Updated just now");
  await page.clock.fastForward(3 * DAY_MS);
  await expect(details(page)).toContainText("Updated 3 days ago");

  await page.evaluate(() => {
    const record = window as unknown as { detailTexts: string[] };
    record.detailTexts = [];
    new MutationObserver(() => {
      const text = document.querySelector(".note-details")?.textContent ?? "";
      if (record.detailTexts.at(-1) !== text) record.detailTexts.push(text);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  await typeAndSave(page, " more");
  await expect(details(page)).toContainText("Updated just now", {
    timeout: 15_000,
  });

  const texts = await page.evaluate(
    () => (window as unknown as { detailTexts: string[] }).detailTexts,
  );
  const lastUnsaved = texts.findLastIndex((text) =>
    text.includes("Not saved yet"),
  );
  expect(lastUnsaved).toBeGreaterThanOrEqual(0);
  const cachedShown = texts.findIndex(
    (text, index) =>
      index > lastUnsaved &&
      text.includes("Created 12 Mar 2026 · Updated 3 days ago"),
  );
  expect(cachedShown).toBeGreaterThan(lastUnsaved);
  const refreshed = texts.findIndex((text) =>
    text.includes("Updated just now"),
  );
  expect(cachedShown).toBeLessThan(refreshed);
  expect(texts.filter((text) => /^\d+ words?$/.test(text))).toEqual([]);
});

test("renaming a note keeps its created date", async ({ page }) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Created 12 Mar 2026");

  await page.clock.fastForward(10 * DAY_MS);
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill("Hello");
  await field.press("Enter");
  await expect(
    page.locator("header.note-header").getByRole("img"),
  ).toBeVisible();
  await waitForSynced(page);

  await expect(details(page)).toContainText("Created 12 Mar 2026", {
    timeout: 15_000,
  });
  await expect(details(page)).toContainText("Updated just now", {
    timeout: 15_000,
  });
});

test("a new note shows it is not saved yet until it is saved", async ({
  page,
}) => {
  await startSession(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();

  await expect(details(page)).toHaveText("Not saved yet · 0 words");

  await page.getByRole("textbox", { name: "Note name" }).fill("Fresh idea");
  await page.getByRole("textbox", { name: "Note name" }).press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("one two three");
  await expect(details(page)).toContainText("3 words");
  await waitForSynced(page);

  await expect(details(page)).toContainText(/Created .*\d{4}/, {
    timeout: 15_000,
  });
  await expect(details(page)).toContainText("Updated just now");
  await expect(details(page)).not.toContainText("Not saved yet");
});

test("no note details are shown when no note is open", async ({ page }) => {
  await startSession(page);

  await expect(details(page)).toHaveCount(0);
});

test("reopening a note shows its dates immediately", async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page).locator("span.note-dates")).toBeVisible();

  await showTree(page);
  await treeItem(page, "Zażółć gęślą jaźń").click();
  await expect(details(page)).toBeVisible();
  await showTree(page);
  await treeItem(page, "Welcome").click();

  await expect(details(page).locator("span.note-dates")).toBeVisible({
    timeout: 1_000,
  });
});

async function moveToTrash(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Move to trash…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

test("a note re-created under a trashed note's name shows its own dates", async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Created 12 Mar 2026");

  await page.clock.fastForward(10 * DAY_MS);
  await showTree(page);
  await moveToTrash(page, "Welcome");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill("Welcome");
  await field.press("Enter");
  await expect(editor(page)).toBeFocused();

  await page.keyboard.type("one");
  await expect(
    page.locator("header.note-header").getByRole("img"),
  ).toBeVisible();
  await typeAndSave(page, " two");
  await typeAndSave(page, " three");
  await waitForSynced(page);

  await expect(details(page)).toContainText("Created 22 Mar 2026", {
    timeout: 15_000,
  });
  await expect(details(page)).not.toContainText("Created 12 Mar 2026");
  await page.clock.fastForward(4_000);
  await expect(details(page)).toContainText("Created 22 Mar 2026");
  await expect(details(page)).not.toContainText("Created 12 Mar 2026");
});

test("a note renamed onto a trashed note's name shows its own dates", async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Created 12 Mar 2026");

  await page.clock.fastForward(10 * DAY_MS);
  await showTree(page);
  await moveToTrash(page, "Welcome");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill("Fresh");
  await field.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("one two");
  await waitForSynced(page);
  await expect(details(page)).toContainText("Created 22 Mar 2026", {
    timeout: 15_000,
  });

  await field.fill("Welcome");
  await field.press("Enter");
  await expect(details(page)).not.toContainText("Created 12 Mar 2026");
  await waitForSynced(page);

  await expect(details(page)).toContainText("Created 22 Mar 2026", {
    timeout: 15_000,
  });
  await page.clock.fastForward(4_000);
  await expect(details(page)).toContainText("Created 22 Mar 2026");
  await expect(details(page)).not.toContainText("Created 12 Mar 2026");
});

test.describe("with GitHub-like forge latency", () => {
  test.use({ forgeLatency: "github" });

  test("a note renamed onto a trashed note's name while saving shows its own dates", async ({
    page,
  }) => {
    await startSession(page);
    await treeItem(page, "Welcome").click();
    await expect(details(page)).toContainText("Created 12 Mar 2026");

    await page.clock.fastForward(10 * DAY_MS);
    await showTree(page);
    await moveToTrash(page, "Welcome");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    const field = page.getByRole("textbox", { name: "Note name" });
    await field.fill("Fresh");
    await field.press("Enter");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("one two");
    await waitForSynced(page);
    await expect(details(page)).toContainText("Created 22 Mar 2026", {
      timeout: 15_000,
    });

    await page.evaluate(() => {
      const seen = window as unknown as { staleCreatedSeen: boolean };
      seen.staleCreatedSeen = false;
      new MutationObserver(() => {
        const text = document.querySelector(".note-details")?.textContent ?? "";
        if (text.includes("Created 12 Mar 2026")) seen.staleCreatedSeen = true;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await typeAtEnd(page, " three");
    await expect(
      page.locator("header.note-header").getByRole("img", { name: "Saving" }),
    ).toBeVisible();
    await field.fill("Welcome");
    await field.press("Enter");
    await waitForSynced(page);

    await expect(details(page)).toContainText("Created 22 Mar 2026", {
      timeout: 15_000,
    });
    await page.clock.fastForward(4_000);
    await expect(details(page)).toContainText("Created 22 Mar 2026");
    await expect(details(page)).not.toContainText("Created 12 Mar 2026");
    expect(
      await page.evaluate(
        () => (window as unknown as { staleCreatedSeen: boolean }).staleCreatedSeen,
      ),
    ).toBe(false);
  });

  test("an unsaved note renamed onto a trashed note's name never shows that note's dates", async ({
    page,
  }) => {
    await startSession(page);
    await treeItem(page, "Welcome").click();
    await expect(details(page)).toContainText("Created 12 Mar 2026");

    await page.clock.fastForward(10 * DAY_MS);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    const field = page.getByRole("textbox", { name: "Note name" });
    await field.fill("Fresh");
    await field.press("Enter");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("one two");
    await waitForSynced(page);
    await expect(details(page)).toContainText("Created 22 Mar 2026", {
      timeout: 15_000,
    });

    await typeAtEnd(page, " three");
    await treeItem(page, "Welcome").click();
    await expect(details(page)).toContainText("Created 12 Mar 2026");
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 5);
    await treeItem(page, "Fresh").click();
    await expect(details(page)).toContainText("Not saved yet");

    await moveToTrash(page, "Welcome");
    await field.fill("Welcome");
    await field.press("Enter");
    await page.evaluate(() => {
      const record = window as unknown as { detailTexts: string[] };
      record.detailTexts = [];
      new MutationObserver(() => {
        const text = document.querySelector(".note-details")?.textContent ?? "";
        if (record.detailTexts.at(-1) !== text) record.detailTexts.push(text);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await page.clock.resume();
    await waitForSynced(page);
    await expect(details(page)).toContainText("Created 22 Mar 2026", {
      timeout: 15_000,
    });
    await page.clock.fastForward(4_000);
    await expect(details(page)).toContainText("Created 22 Mar 2026");

    const texts = await page.evaluate(
      () => (window as unknown as { detailTexts: string[] }).detailTexts,
    );
    expect(texts.filter((text) => text.includes("Created 12 Mar 2026"))).toEqual(
      [],
    );
  });
});

test("a note re-created under a reused name on another device shows its own dates", async ({
  page,
  openSecondDevice,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Created 12 Mar 2026");
  await treeItem(page, "Zażółć gęślą jaźń").click();
  await expect(details(page)).toBeVisible();
  await page.clock.fastForward(3 * DAY_MS);

  const { page: other } = await openSecondDevice({
    locale: "en-GB",
    timezoneId: "Europe/Warsaw",
  });
  await other.clock.install({ time: T0 });
  await logIn(other, { repo: SAMPLE.repo, passphrase: SAMPLE.passphrase });
  await expectTree(other);
  await other.clock.fastForward(10 * DAY_MS);
  await moveToTrash(other, "Welcome");
  await other.getByRole("button", { name: "New note", exact: true }).click();
  const field = other.getByRole("textbox", { name: "Note name" });
  await field.fill("Welcome");
  await field.press("Enter");
  await expect(editor(other)).toBeFocused();
  await other.keyboard.type("one");
  await expect(
    other.locator("header.note-header").getByRole("img"),
  ).toBeVisible();
  await typeAndSave(other, " two");
  await typeAndSave(other, " three");
  await waitForSynced(other);
  await expect(details(other)).toContainText("Created 22 Mar 2026", {
    timeout: 15_000,
  });

  await handOverRepo(other, page);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("open-trash")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    const record = window as unknown as { detailTexts: string[] };
    record.detailTexts = [];
    document.addEventListener(
      "click",
      () => {
        record.detailTexts = [];
      },
      { capture: true, once: true },
    );
    new MutationObserver(() => {
      const text = document.querySelector(".note-details")?.textContent ?? "";
      if (record.detailTexts.at(-1) !== text) record.detailTexts.push(text);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await treeItem(page, "Welcome").click();

  await expect(details(page)).toContainText("Created 22 Mar 2026", {
    timeout: 15_000,
  });
  await page.clock.fastForward(4_000);
  await expect(details(page)).toContainText("Created 22 Mar 2026");
  const texts = await page.evaluate(
    () => (window as unknown as { detailTexts: string[] }).detailTexts,
  );
  expect(texts.filter((text) => text.includes("Created 12 Mar 2026"))).toEqual(
    [],
  );
});

test("the left alignment of note details text matches the editor text", { tag: "@mobile" }, async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toBeVisible();

  const detailsTextX = await page.evaluate(() => {
    const detailsEl = document.querySelector(".note-details");
    if (!detailsEl) throw new Error(".note-details not found");

    const findFirstTextNode = (node: Node): Text | null => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          return child as Text;
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
          const result = findFirstTextNode(child);
          if (result) return result;
        }
      }
      return null;
    };

    const firstTextNode = findFirstTextNode(detailsEl);
    if (!firstTextNode) throw new Error("No text node in .note-details");
    const range = new Range();
    range.setStart(firstTextNode, 0);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return rect.left;
  });

  const editorLineTextX = await page.evaluate(() => {
    const firstLine = document.querySelector(".cm-line");
    if (!firstLine) throw new Error(".cm-line not found");

    const findFirstTextNode = (node: Node): Text | null => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          return child as Text;
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
          const result = findFirstTextNode(child);
          if (result) return result;
        }
      }
      return null;
    };

    const firstTextNode = findFirstTextNode(firstLine);
    if (!firstTextNode) throw new Error("No text node in .cm-line");
    const range = new Range();
    range.setStart(firstTextNode, 0);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return rect.left;
  });

  expect(Math.abs(detailsTextX - editorLineTextX)).toBeLessThanOrEqual(1);
});
