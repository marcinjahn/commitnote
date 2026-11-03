import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { TouchFinger, openNotes } from "./helpers";
import { enableVimMode } from "./helpers/settings";
import { createLink } from "./helpers/sharing";
import { openWelcome, treeItem, waitForSynced } from "./helpers/tree";

const HEADER = "| Column A | Column B |";
const DELIMITER = "| --- | --- |";
const LAST_ROW = "| 1 | 2 |";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WIDE_HEADERS = [
  ...MONTHS.map((month) => `${month} 2026`),
  "January 2027",
];
const LONG_SENTENCE =
  "This cell holds one long sentence that keeps going well past the width of any phone screen, " +
  "so the table has to wrap it onto several lines instead of growing wider than the note itself.";

const LONG_TEXT = Array.from(
  { length: 14 },
  (_, i) =>
    `Sentence number ${i + 1} keeps this single line long enough to wrap`,
).join(" ");

const pane = (page: Page) => page.locator("#note-pane");
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note editor" });
const tables = (page: Page) => pane(page).locator("table.cm-table");
const line = (page: Page, text: string) =>
  pane(page).locator(".cm-line", { hasText: text });
const openTaskLine = (page: Page) => line(page, "Open task");
const modeText = (page: Page) => page.locator(".vim-status-bar .mode-label");

function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

async function openWelcomeNote(page: Page): Promise<void> {
  await openNotes(page);
  await openWelcome(page);
  await expect(tables(page)).toHaveCount(1);
}

async function expectRevealed(page: Page): Promise<void> {
  await expect(line(page, DELIMITER)).toBeVisible();
  await expect(tables(page)).toHaveCount(0);
}

async function appendToLine(page: Page, expected: string): Promise<void> {
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  await expect(line(page, expected)).toHaveText(expected);
}

async function caretAboveTable(page: Page): Promise<void> {
  await openTaskLine(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await expect(tables(page)).toHaveCount(1);
}

async function caretBelowTable(page: Page): Promise<void> {
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(tables(page)).toHaveCount(1);
}

async function expectWrapped(
  page: Page,
  wrapped: ReturnType<typeof line>,
): Promise<void> {
  const single = await openTaskLine(page).boundingBox();
  const box = await wrapped.boundingBox();
  expect(single).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(single!.height * 3);
}

async function expectCaretIn(
  container: ReturnType<typeof line>,
): Promise<void> {
  await expect
    .poll(() =>
      container.evaluate((el) => el.contains(getSelection()!.focusNode)),
    )
    .toBe(true);
}

async function pressUntilRevealed(page: Page, key: string): Promise<void> {
  for (let i = 0; i < 10 && (await tables(page).count()) > 0; i++) {
    await page.keyboard.press(key);
  }
  await expectRevealed(page);
}

test("Welcome's table renders as a table", async ({ page }) => {
  await openWelcomeNote(page);

  const table = tables(page);
  await expect(table.getByRole("columnheader")).toHaveText([
    "Column A",
    "Column B",
  ]);
  await expect(
    table.getByRole("cell", { name: "1", exact: true }),
  ).toBeVisible();
  await expect(
    pane(page).locator(".cm-line", { hasText: "| --- |" }),
  ).toHaveCount(0);
});

test("clicking a cell reveals the table with the caret after the cell's text", async ({
  page,
}) => {
  await openWelcomeNote(page);

  await tables(page).getByRole("columnheader", { name: "Column B" }).click();
  await expectRevealed(page);
  const before = await pane(page).locator(".cm-content").innerText();
  expect(before.split(HEADER)).toHaveLength(2);
  await page.keyboard.type("X");
  await expect(line(page, "Column BX")).toHaveText("| Column A | Column BX |");

  await page.keyboard.press("ControlOrMeta+Home");
  await expect(tables(page)).toHaveCount(1);
  await expect(
    tables(page).getByRole("columnheader", { name: "Column BX" }),
  ).toBeVisible();

  await waitForSynced(page);
  await treeItem(page, "Zażółć gęślą jaźń").click();
  await openWelcome(page);
  await expect(
    tables(page).getByRole("columnheader", { name: "Column BX" }),
  ).toBeVisible();

  await tables(page).getByRole("columnheader", { name: "Column BX" }).click();
  await expectRevealed(page);
  await expect(line(page, "Column BX")).toHaveText("| Column A | Column BX |");
  await expect(line(page, DELIMITER)).toHaveText(DELIMITER);
  await expect(line(page, LAST_ROW)).toHaveText(LAST_ROW);
  await expect
    .poll(() => pane(page).locator(".cm-content").innerText())
    .toBe(before.replace(HEADER, "| Column A | Column BX |"));
});

test.describe("keyboard entry", () => {
  test("ArrowDown from the line above lands on the first line", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await caretAboveTable(page);

    await page.keyboard.press("ArrowDown");
    await expectRevealed(page);
    await appendToLine(page, `${HEADER}Z`);
  });

  test("ArrowUp from the line below lands on the last line", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await caretBelowTable(page);

    await page.keyboard.press("ArrowUp");
    await expectRevealed(page);
    await appendToLine(page, `${LAST_ROW}Z`);
  });

  test("ArrowRight at the end of the line above lands on the first line", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await caretAboveTable(page);

    await page.keyboard.press("ArrowRight");
    await expectRevealed(page);
    await appendToLine(page, `${HEADER}Z`);
  });

  test("ArrowLeft at the start of the line below lands on the last line", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await caretBelowTable(page);

    await page.keyboard.press("ArrowLeft");
    await expectRevealed(page);
    await appendToLine(page, `${LAST_ROW}Z`);
  });

  test("ArrowDown moves through a wrapped line above before entering", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await caretAboveTable(page);
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(LONG_TEXT);
    const paragraph = line(page, LONG_TEXT.slice(0, 40));
    await expectWrapped(page, paragraph);
    await expect(tables(page)).toHaveCount(1);

    await paragraph.click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("ArrowDown");
    await expect(tables(page)).toHaveCount(1);
    await expectCaretIn(paragraph);

    await pressUntilRevealed(page, "ArrowDown");
    await appendToLine(page, `${HEADER}Z`);
  });

  test("ArrowUp moves through a wrapped line below before entering", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await caretBelowTable(page);
    await page.keyboard.insertText(`- ${LONG_TEXT}`);
    const item = line(page, LONG_TEXT.slice(0, 40));
    await expectWrapped(page, item);
    await expect(tables(page)).toHaveCount(1);

    await page.keyboard.press("ArrowUp");
    await expect(tables(page)).toHaveCount(1);
    await expectCaretIn(item);

    await pressUntilRevealed(page, "ArrowUp");
    await appendToLine(page, `${LAST_ROW}Z`);
  });
});

test("Vim j and k enter the table from the adjacent lines", async ({
  page,
}) => {
  await openNotes(page);
  await enableVimMode(page);
  await openWelcome(page);
  await expect(modeText(page)).toHaveText("NORMAL");

  await openTaskLine(page).click();
  await page.keyboard.press("j");
  await expect(tables(page)).toHaveCount(1);
  await page.keyboard.press("j");
  await expectRevealed(page);
  await page.keyboard.press("$");
  await page.keyboard.press("a");
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  await expect(modeText(page)).toHaveText("NORMAL");
  await expect(line(page, `${HEADER}Z`)).toHaveText(`${HEADER}Z`);

  await page.keyboard.press("u");
  await expect(line(page, "Column A")).toHaveText(HEADER);
  await page.keyboard.press("G");
  await expect(tables(page)).toHaveCount(1);
  await page.keyboard.press("k");
  await expectRevealed(page);
  await page.keyboard.press("$");
  await page.keyboard.press("a");
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  await expect(line(page, `${LAST_ROW}Z`)).toHaveText(`${LAST_ROW}Z`);
});

test("the share viewer renders the table and a click does not reveal it", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await createLink(page);

  const viewer = await page.context().newPage();
  await viewer.goto(link);
  const table = viewer.locator("table.cm-table");
  await expect(table.getByRole("columnheader")).toHaveText([
    "Column A",
    "Column B",
  ]);

  await table.getByRole("cell", { name: "1", exact: true }).click();
  await expect(table).toBeVisible();
  await expect(viewer.locator(".cm-line", { hasText: "| --- |" })).toHaveCount(
    0,
  );
});

test(
  "a wide table scrolls inside its scroller and long text wraps",
  { tag: "@mobile" },
  async ({ page, hasTouch }) => {
    await openWelcomeNote(page);
    await caretBelowTable(page);
    const lines = pane(page).locator(".cm-line");
    const lineCount = await lines.count();
    await page.keyboard.press("Enter");
    // CodeMirror applies Enter asynchronously on Android.
    await expect(lines).toHaveCount(lineCount + 1);
    await page.keyboard.insertText(
      [
        row(WIDE_HEADERS),
        row(WIDE_HEADERS.map(() => "---")),
        row(WIDE_HEADERS.map((_, i) => String(i + 1))),
        row(WIDE_HEADERS.map((_, i) => String((i + 1) * 10))),
        "",
        row(["Topic", "Notes"]),
        row(["---", "---"]),
        row(["Wrap", LONG_SENTENCE]),
        "",
      ].join("\n"),
    );
    await page.keyboard.press("ControlOrMeta+Home");
    await expect(tables(page)).toHaveCount(3);

    const wide = pane(page)
      .locator(".cm-table-scroller")
      .filter({
        has: page.getByRole("columnheader", { name: "January 2027" }),
      });
    await expect
      .poll(() => wide.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeGreaterThan(0);

    if (hasTouch) {
      await wide.scrollIntoViewIfNeeded();
      const box = (await wide.boundingBox())!;
      const y = box.y + box.height / 2;
      const finger = await TouchFinger.on(page);
      await finger.down({ x: box.x + box.width - 20, y });
      await finger.move({ x: box.x + 20, y });
      await finger.up();
    } else {
      await wide.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
    }
    await expect
      .poll(() => wide.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    await expect(tables(page)).toHaveCount(3);
    await expect(
      pane(page).locator(".cm-line", { hasText: "| --- |" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const wrapping = pane(page)
      .locator(".cm-table-scroller")
      .filter({ has: page.getByRole("cell", { name: "Wrap", exact: true }) });
    const widths = await wrapping.evaluate((el) => ({
      table: el.querySelector("table")!.getBoundingClientRect().width,
      scroller: el.clientWidth,
    }));
    expect(widths.table).toBeLessThanOrEqual(widths.scroller);
    const lineBoxes = await wrapping
      .getByRole("cell", { name: LONG_SENTENCE })
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((rect) => rect.top))
          .size;
      });
    expect(lineBoxes).toBeGreaterThan(1);
  },
);
