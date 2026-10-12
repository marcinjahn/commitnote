import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openNotes, showTree, handOverRepo } from "./helpers";
import { headerSyncIcon, moveToTrash, treeItem, waitForSynced } from "./helpers/tree";

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

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

async function typeAndSave(page: Page, text: string): Promise<void> {
  await typeAtEnd(page, text);
  await expect(
    headerSyncIcon(page),
  ).toBeVisible();
  await waitForSynced(page);
}

async function wordCount(page: Page): Promise<number> {
  const text = (await details(page).textContent()) ?? "";
  const match = /(\d+) words?/.exec(text);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

function firstTextLeft(page: Page, selector: string): Promise<number> {
  return page.evaluate((css) => {
    const root = document.querySelector(css);
    if (!root) throw new Error(`${css} not found`);

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

    const firstTextNode = findFirstTextNode(root);
    if (!firstTextNode) throw new Error(`No text node in ${css}`);
    const range = new Range();
    range.setStart(firstTextNode, 0);
    range.collapse(true);
    return range.getBoundingClientRect().left;
  }, selector);
}

test("shows created and updated dates and the word count above the editor", { tag: "@mobile" }, async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();

  const line = details(page);
  const list = line.getByRole("list", { name: "Note details" });
  await expect(list).toHaveCount(1);
  await expect(list.getByRole("listitem")).toHaveText([
    "Created 12 Mar 2026",
    "Updated just now",
    /^\d+ words$/,
    "1/2 tasks done",
  ]);
  await expect
    .poll(() =>
      page
        .locator(".note-content")
        .evaluate(
          (el) =>
            el
              .getAnimations({ subtree: true })
              .filter((animation) => !(animation instanceof CSSAnimation)).length,
        ),
    )
    .toBe(0);

  const lineBox = await line.boundingBox();
  const editorBox = await editor(page).boundingBox();
  expect(lineBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(editorBox!.y);
  await expect(page.locator(".note-content .note-details")).toHaveCount(1);

  const times = line.locator(".note-dates time");
  await expect(times).toHaveCount(2);
  for (const time of await times.all()) {
    const datetime = await time.getAttribute("datetime");
    expect(new Date(datetime!).toDateString()).toBe(T0.toDateString());
    expect(await time.getAttribute("title")).toBeTruthy();
  }

  const before = await wordCount(page);
  await typeAtEnd(page, " alpha beta");
  await expect(line).toContainText(`${before + 2} words`);
});

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseRgb(color: string): [number, number, number] {
  const match = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(color);
  expect(match, `unparsed colour ${color}`).not.toBeNull();
  return [Number(match![1]), Number(match![2]), Number(match![3])];
}

function luminance(color: string): number {
  const [r, g, b] = parseRgb(color).map(channelToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test("note details show unbreakable items in a dates group and a stats group", { tag: "@mobile" }, async ({
  page,
}) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();

  const items = details(page).getByRole("listitem");
  await expect(items).toHaveCount(4);
  await expect
    .poll(() =>
      page
        .locator(".note-content")
        .evaluate(
          (el) =>
            el
              .getAnimations({ subtree: true })
              .filter((animation) => !(animation instanceof CSSAnimation)).length,
        ),
    )
    .toBe(0);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const row = document.querySelector(".note-details")!;
        const lineHeight = parseFloat(getComputedStyle(row).lineHeight);
        return [...row.querySelectorAll("[role=listitem]")].every(
          (item) => item.getBoundingClientRect().height <= lineHeight + 1,
        );
      }),
    )
    .toBe(true);

  const narrow = page.viewportSize()!.width < 600;
  await expect
    .poll(async () => {
      const [dates, stats] = await page.evaluate(() =>
        [...document.querySelectorAll(".note-details .details-group")].map((group) => {
          const { top, bottom, left, right } = group.getBoundingClientRect();
          return { top, bottom, left, right };
        }),
      );
      return {
        stacked: stats.top > dates.bottom - 1,
        flushLeft: Math.abs(stats.left - dates.left) <= 1,
        spaced: stats.left - dates.right >= 31,
      };
    })
    .toEqual({ stacked: narrow, flushLeft: narrow, spaced: !narrow });

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
      )
      .toContain(scheme);
    await expect
      .poll(async () => {
        const { value, label, background } = await page.evaluate(() => {
          const pixel = (color: string): number[] => {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext("2d")!;
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
          };
          const toRgb = (color: string): string => {
            const [r, g, b] = pixel(color);
            return `rgb(${r}, ${g}, ${b})`;
          };
          const valueEl = document.querySelector(".note-details .detail-value")!;
          const labelEl = document.querySelector(".note-details .detail-label")!;
          let backgroundEl: Element = document.body;
          for (let el: Element | null = labelEl; el; el = el.parentElement) {
            if (pixel(getComputedStyle(el).backgroundColor)[3] > 0) {
              backgroundEl = el;
              break;
            }
          }
          const background = getComputedStyle(backgroundEl).backgroundColor;
          return {
            value: toRgb(getComputedStyle(valueEl).color),
            label: toRgb(getComputedStyle(labelEl).color),
            background: toRgb(background),
          };
        });
        return {
          differ: value !== label,
          readable: contrastRatio(label, background) >= 4.5,
        };
      })
      .toEqual({ differ: true, readable: true });
  }

  await page.setViewportSize({ width: 140, height: page.viewportSize()!.height });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const row = document.querySelector(".note-details")!;
        const lineHeight = parseFloat(getComputedStyle(row).lineHeight);
        const rects = [...row.querySelectorAll("[role=listitem]")].map((item) =>
          item.getBoundingClientRect(),
        );
        return {
          singleLine: rects.every((rect) => rect.height <= lineHeight + 1),
          ownLines: new Set(rects.map((rect) => Math.round(rect.top))).size,
        };
      }),
    )
    .toEqual({ singleLine: true, ownLines: 4 });
});

test("shows task progress only when the note has tasks", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill("Checklist");
  await field.press("Enter");
  await expect(editor(page)).toBeFocused();

  await page.keyboard.type("plain text");
  await expect(details(page)).toContainText("2 words");
  await expect(details(page)).not.toContainText("done");

  await typeAtEnd(page, "\n- [x] a\nb");
  await expect(details(page)).toContainText("1/2 tasks done");
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
      text.includes("Created 12 Mar 2026 Updated 3 days ago"),
  );
  expect(cachedShown).toBeGreaterThan(lastUnsaved);
  const refreshed = texts.findIndex((text) =>
    text.includes("Updated just now"),
  );
  expect(cachedShown).toBeLessThan(refreshed);
  expect(texts.filter((text) => /^\d+ words?$/.test(text))).toEqual([]);
});

async function observeSettle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = window as unknown as { settleCount: number };
    record.settleCount = 0;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target as Element;
        if (target.matches(".note-dates time") && target.hasAttribute("data-settle")) {
          record.settleCount += 1;
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-settle"],
    });
  });
}

function settleCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { settleCount: number }).settleCount);
}

test("the updated time settles after a save", async ({ page }) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Updated");
  await observeSettle(page);

  await typeAndSave(page, " more");
  await expect.poll(() => settleCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect(details(page).locator(".note-dates time").nth(1)).not.toHaveAttribute(
    "data-settle",
  );
});

test("switching notes does not settle the updated time", async ({ page }) => {
  await startSession(page);
  await treeItem(page, "Welcome").click();
  await expect(details(page)).toContainText("Updated");
  await observeSettle(page);

  await treeItem(page, "Projects").click();
  await treeItem(page, "commitnote").click();
  await treeItem(page, "Roadmap").click();
  await expect(details(page).locator(".note-dates")).toBeVisible();
  expect(await settleCount(page)).toBe(0);
});

test("a new note shows it is not saved yet until it is saved", async ({
  page,
}) => {
  await startSession(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();

  await expect(details(page).getByRole("listitem")).toHaveText([
    "Not saved yet",
    "0 words",
  ]);

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
  await expect(details(page).locator(".note-dates")).toBeVisible();

  await showTree(page);
  await treeItem(page, "Zażółć gęślą jaźń").click();
  await expect(details(page)).toBeVisible();
  await showTree(page);
  await treeItem(page, "Welcome").click();

  await expect(details(page).locator(".note-dates")).toBeVisible({
    timeout: 1_000,
  });
});

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
    headerSyncIcon(page),
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
    await page.clock.pauseAt(now + 250);
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
  await openNotes(other);
  await other.clock.fastForward(10 * DAY_MS);
  await moveToTrash(other, "Welcome");
  await other.getByRole("button", { name: "New note", exact: true }).click();
  const field = other.getByRole("textbox", { name: "Note name" });
  await field.fill("Welcome");
  await field.press("Enter");
  await expect(editor(other)).toBeFocused();
  await other.keyboard.type("one");
  await expect(
    headerSyncIcon(other),
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
      const text =
        document.querySelector(".note-content:not(.held) .note-details")?.textContent ?? "";
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
  await expect
    .poll(() =>
      page
        .locator(".note-pane")
        .evaluate((pane) => pane.getAnimations().length),
    )
    .toBe(0);

  const detailsTextX = await firstTextLeft(page, ".note-details");
  const editorLineTextX = await firstTextLeft(page, ".cm-line");

  expect(Math.abs(detailsTextX - editorLineTextX)).toBeLessThanOrEqual(1);
});
