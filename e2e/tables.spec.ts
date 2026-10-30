import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { TouchFinger, flushPendingSaves, openNotes } from "./helpers";
import { WHITEBOARD_IMAGE_ID } from "./helpers/images";
import {
  chooseAccent,
  chooseOption,
  closeSettings,
  enableVimMode,
  openSettings,
} from "./helpers/settings";
import { createLink } from "./helpers/sharing";
import { openWelcome, treeItem, waitForSynced } from "./helpers/tree";
import { ACCENT_PALETTE } from "../src/settings/accent-palette";

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

function hexToRgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

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

test("the header rule uses the full accent colour in light and dark", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await openSettings(page);
  const headerRule = () =>
    tables(page)
      .locator("th")
      .first()
      .evaluate((th) => getComputedStyle(th).borderBottomColor);
  const accentColor = () =>
    page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-accent)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });

  for (const mode of ["Light", "Dark"] as const) {
    await chooseOption(page, "Color mode", mode);
    for (const accent of ACCENT_PALETTE) {
      await chooseAccent(page, accent.label);
      if ("light" in accent) {
        const hex = mode === "Light" ? accent.light : accent.dark;
        await expect.poll(headerRule).toBe(hexToRgb(hex));
      } else {
        await expect
          .poll(async () => (await headerRule()) === (await accentColor()))
          .toBe(true);
      }
    }
  }

  await closeSettings(page);
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

test("the empty rows of a typed table are as tall as a filled row and can be clicked @mobile", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await caretBelowTable(page);
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(
    [
      "",
      row(["Empty A", "Empty B"]),
      row(["---", "---"]),
      "|  |  |",
      "|  |  |",
    ].join("\n"),
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await expect(tables(page)).toHaveCount(2);

  const rows = tables(page)
    .filter({ has: page.getByRole("columnheader", { name: "Empty A" }) })
    .locator("tr");
  await expect(rows).toHaveCount(3);
  await expect
    .poll(async () => {
      const heights: number[] = [];
      for (let index = 0; index < 3; index++) {
        const box = await rows.nth(index).boundingBox();
        heights.push(box?.height ?? 0);
      }
      const [header, ...body] = heights;
      return (
        header > 0 && body.every((h) => h >= header - 1 && h <= header + 1)
      );
    })
    .toBe(true);

  await rows.nth(1).locator("td").first().click();
  await expect(tables(page)).toHaveCount(1);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("X");
  await expect(
    pane(page).locator(".cm-line", { hasText: /^\|\s*X\s*\|/ }),
  ).toHaveCount(1);
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

async function expectTextOnOwnLines(page: Page): Promise<void> {
  await expect(tables(page)).toHaveCount(1);
  const lines = editor(page).locator(".cm-line");
  await expect(lines.last()).toHaveText("bar");
  const texts = await lines.evaluateAll((els) =>
    els.map((el) => el.textContent),
  );
  expect(texts.slice(-3)).toEqual(["", "foo", "bar"]);
  await expect(tables(page).locator("td", { hasText: "foo" })).toHaveCount(0);
}

test("typing right after a rendered table starts a new line", async ({
  page,
}) => {
  await openWelcomeNote(page);
  await caretBelowTable(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("foo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("bar");

  await expectTextOnOwnLines(page);
});

test("pasting multi-line text right after a rendered table keeps its first line break", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openWelcomeNote(page);
  await caretBelowTable(page);
  await page.evaluate(() => navigator.clipboard.writeText("\nfoo\nbar"));
  await page.keyboard.press("ControlOrMeta+v");

  await expectTextOnOwnLines(page);
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

test.describe("nested tables", () => {
  const NESTED_CONTENT = [
    "Between one",
    "",
    "> Quoted line",
    "",
    "> | Quoted | Value |",
    "> | --- | --- |",
    "> | q1 | v1 |",
    "",
    "Between two",
    "",
    "> > | Deep | Value |",
    "> > | --- | --- |",
    "> > | d1 | v1 |",
    "",
    "Between three",
    "",
    "- Item text",
    "",
    "  Continuation text",
    "",
    "  | Listed | Value |",
    "  | --- | --- |",
    "  | l1 | v1 |",
    "",
  ];

  async function appendContent(
    page: Page,
    content: readonly string[],
    expectedTables: number,
  ): Promise<void> {
    await openWelcomeNote(page);
    await caretBelowTable(page);
    const lines = pane(page).locator(".cm-line");
    const lineCount = await lines.count();
    await page.keyboard.press("Enter");
    // CodeMirror applies Enter asynchronously on Android.
    await expect(lines).toHaveCount(lineCount + 1);
    await page.keyboard.insertText(content.join("\n"));
    await page.keyboard.press("ControlOrMeta+Home");
    await expect(tables(page)).toHaveCount(expectedTables);
  }

  const widgetWith = (page: Page, header: string) =>
    pane(page)
      .locator(".cm-table-widget")
      .filter({ has: page.getByRole("columnheader", { name: header }) });

  const tableLeft = (table: Locator) =>
    table.evaluate((el) => el.getBoundingClientRect().left);

  function firstCharLeft(container: Locator, text: string): Promise<number> {
    return container.evaluate((el, wanted) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(wanted) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        return range.getBoundingClientRect().left;
      }
      throw new Error("text not found");
    }, text);
  }

  test("tables in blockquotes and list items render with bars and indent", async ({
    page,
  }) => {
    await appendContent(page, NESTED_CONTENT, 4);
    await expect(
      pane(page).locator(".cm-line", { hasText: "| --- |" }),
    ).toHaveCount(0);

    const quoted = widgetWith(page, "Quoted");
    const deep = widgetWith(page, "Deep");
    await expect(quoted.locator(".cm-table-quote")).toHaveCount(1);
    await expect(deep.locator(".cm-table-quote")).toHaveCount(2);

    const quoteLine = line(page, "Quoted line");
    await expect
      .poll(async () => {
        const [bar, source] = await Promise.all([
          quoted
            .locator(".cm-table-quote")
            .evaluate((el) => getComputedStyle(el).borderLeftColor),
          quoteLine.evaluate((el) => getComputedStyle(el).borderLeftColor),
        ]);
        return bar === source;
      })
      .toBe(true);

    await expect
      .poll(async () => {
        const [bar, source] = await Promise.all([
          quoted
            .locator(".cm-table-quote")
            .evaluate((el) => el.getBoundingClientRect().left),
          quoteLine.evaluate((el) => el.getBoundingClientRect().left),
        ]);
        return Math.abs(bar - source);
      })
      .toBeLessThanOrEqual(1);

    await expect
      .poll(async () => {
        const nestedOffset =
          (await tableLeft(widgetWith(page, "Listed").locator("table"))) -
          (await firstCharLeft(
            line(page, "Continuation text"),
            "Continuation text",
          ));
        const topOffset =
          (await tableLeft(tables(page).first())) -
          (await firstCharLeft(line(page, "Between one"), "Between one"));
        return Math.abs(nestedOffset - topOffset);
      })
      .toBeLessThanOrEqual(2);
  });

  test("clicking a cell of a nested table reveals only that table", async ({
    page,
  }) => {
    await appendContent(page, NESTED_CONTENT, 4);

    await widgetWith(page, "Quoted").getByRole("cell", { name: "q1" }).click();
    await expect(tables(page)).toHaveCount(3);
    await expect(
      pane(page).locator(".cm-line", { hasText: "| --- |" }),
    ).toHaveCount(1);
    await expectCaretIn(line(page, "q1"));
    await expect(widgetWith(page, "Deep")).toHaveCount(1);
    await expect(widgetWith(page, "Listed")).toHaveCount(1);
  });

  test("ArrowDown from above a list table enters its first line", async ({
    page,
  }) => {
    await appendContent(page, NESTED_CONTENT, 4);

    await line(page, "Continuation text").click();
    await page.keyboard.press("ArrowDown");
    await expect(tables(page)).toHaveCount(4);
    await page.keyboard.press("ArrowDown");
    await expect(tables(page)).toHaveCount(3);
    await expect(line(page, "| Listed | Value |")).toBeVisible();
    await expectCaretIn(line(page, "| Listed | Value |"));
  });

  test("an irregular nested table stays source", async ({ page }) => {
    await appendContent(
      page,
      [
        "Between one",
        "",
        "> | Lazy | Value |",
        "> | --- | --- |",
        "| z1 | v1 |",
        "",
      ],
      1,
    );

    await expect(line(page, "| z1 | v1 |")).toBeVisible();
    await expect(
      pane(page).locator(".cm-line", { hasText: "| --- |" }),
    ).toHaveCount(1);
  });
});

test.describe("cell images", () => {
  const PICTURE_ROW = `| ![Whiteboard](image:${WHITEBOARD_IMAGE_ID}) |`;

  async function appendImageTable(
    page: Page,
    rows: readonly string[],
  ): Promise<void> {
    await openWelcomeNote(page);
    await caretBelowTable(page);
    const lines = pane(page).locator(".cm-line");
    const lineCount = await lines.count();
    await page.keyboard.press("Enter");
    await expect(lines).toHaveCount(lineCount + 1);
    await page.keyboard.insertText(
      ["", "| Picture |", "| --- |", ...rows, ""].join("\n"),
    );
    await page.keyboard.press("ControlOrMeta+Home");
    await expect(tables(page)).toHaveCount(2);
  }

  const cellImage = (scope: Page | Locator) => scope.locator(".cm-table-image");

  test(
    "an image reference shows the image inside its cell",
    { tag: "@mobile" },
    async ({ page }) => {
      await appendImageTable(page, [PICTURE_ROW]);

      const image = cellImage(pane(page));
      await expect(image).toHaveAttribute("data-state", "loaded");
      const img = image.locator("img");
      expect(
        await img.evaluate((el: HTMLImageElement) => el.naturalWidth),
      ).toBeGreaterThan(0);
      await expect(image.locator(".cm-table-image-alt")).toBeHidden();

      const box = (await img.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(160.5);
      const cellContentWidth = await image.evaluate((el) => {
        const cell = el.closest("td")!;
        const style = getComputedStyle(cell);
        return (
          cell.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)
        );
      });
      expect(box.width).toBeLessThanOrEqual(cellContentWidth + 0.5);
    },
  );

  test("an unavailable image shows its alt text", async ({ page }) => {
    await appendImageTable(page, [
      "| ![Missing picture](image:aaaaaaaaaaaaaaaaaaaaaaaaaa#40x30) |",
    ]);

    const image = cellImage(pane(page));
    await expect(image).toHaveAttribute("data-state", "unavailable");
    await expect(image.locator(".cm-table-image-alt")).toHaveText(
      "Missing picture",
    );
    await expect(image.locator("img")).toBeHidden();
  });

  test("clicking an image reveals the table at its row", async ({ page }) => {
    await appendImageTable(page, [PICTURE_ROW]);
    const image = cellImage(pane(page));
    await expect(image).toHaveAttribute("data-state", "loaded");

    await image.locator("img").click();

    await expect(line(page, "| --- |").last()).toBeVisible();
    await expect(tables(page)).toHaveCount(1);
    await expectCaretIn(line(page, "![Whiteboard](image:"));
  });

  test("the share viewer shows the image and a click does not reveal the table", async ({
    page,
  }) => {
    await appendImageTable(page, [PICTURE_ROW]);
    await expect(cellImage(pane(page))).toHaveAttribute("data-state", "loaded");
    await flushPendingSaves(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const link = await createLink(page);

    const viewer = await page.context().newPage();
    await viewer.goto(link);
    const image = viewer.locator(".cm-table-image");
    await expect(image).toHaveAttribute("data-state", "loaded");
    expect(
      await image
        .locator("img")
        .evaluate((el: HTMLImageElement) => el.naturalWidth),
    ).toBeGreaterThan(0);

    await image.locator("img").click();
    await expect(image).toBeVisible();
    await expect(
      viewer.locator(".cm-line", { hasText: "| --- |" }),
    ).toHaveCount(0);
  });
});

const FRUIT = [
  "| Fruit | Colour |",
  "| --- | --- |",
  "| Apple | Red |",
  "| Lemon | Yellow |",
];
const AFTER_FRUIT = "After fruit";

interface Point {
  readonly x: number;
  readonly y: number;
}

const fruitTable = (page: Page) =>
  tables(page).filter({
    has: page.getByRole("columnheader", { name: "Fruit" }),
  });
const fruitCell = (page: Page, name: string) =>
  fruitTable(page).getByRole("cell", { name, exact: true });
const selectedText = (page: Page) =>
  page.evaluate(() => getSelection()?.toString() ?? "");

async function textPoint(target: Locator, fraction: number): Promise<Point> {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((el, at) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width * at, y: rect.top + rect.height / 2 };
  }, fraction);
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function dragAcrossFruit(page: Page): Promise<void> {
  await drag(
    page,
    await textPoint(fruitCell(page, "Apple"), 0.4),
    await textPoint(fruitCell(page, "Yellow"), 0.6),
  );
  await expect.poll(() => selectedText(page)).toContain("Lemon");
  await expect
    .poll(() =>
      fruitTable(page).evaluate(
        (el) => document.activeElement === el.closest(".cm-table-widget"),
      ),
    )
    .toBe(true);
}

async function dragFruitWords(
  page: Page,
  from: Locator,
  to: Locator,
): Promise<void> {
  await drag(page, await textPoint(from, 0), await textPoint(to, 1));
  await expect
    .poll(() =>
      fruitTable(page).evaluate(
        (el) => document.activeElement === el.closest(".cm-table-widget"),
      ),
    )
    .toBe(true);
}

interface CopiedData {
  readonly text: string;
  readonly html: string;
}

async function recordCopy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { copied: CopiedData | null };
    target.copied = null;
    window.addEventListener("copy", (event) => {
      target.copied = {
        text: event.clipboardData?.getData("text/plain") ?? "",
        html: event.clipboardData?.getData("text/html") ?? "",
      };
    });
  });
}

async function copiedData(page: Page): Promise<CopiedData | null> {
  return page.evaluate(
    () => (window as unknown as { copied: CopiedData | null }).copied,
  );
}

async function appendFruitTable(page: Page): Promise<void> {
  await openWelcomeNote(page);
  await caretBelowTable(page);
  const lines = pane(page).locator(".cm-line");
  const lineCount = await lines.count();
  await page.keyboard.press("Enter");
  await expect(lines).toHaveCount(lineCount + 1);
  await page.keyboard.insertText([...FRUIT, "", AFTER_FRUIT].join("\n"));
  await page.keyboard.press("ControlOrMeta+Home");
  await expect(tables(page)).toHaveCount(2);
}

async function expectFruitRevealed(page: Page): Promise<void> {
  await expect(line(page, "| Apple | Red |")).toBeVisible();
  await expect(tables(page)).toHaveCount(1);
}

test.describe("table text selection", () => {
  test("a drag across cells selects their text without revealing the table", async ({
    page,
  }) => {
    await appendFruitTable(page);

    await dragAcrossFruit(page);

    expect(await selectedText(page)).toContain("Red");
    await expect(tables(page)).toHaveCount(2);
    await expect(pane(page).locator(".cm-table-source-line")).toHaveCount(0);
  });

  test("a drag beyond the table stays in it and a later click edits normally", async ({
    page,
  }) => {
    await appendFruitTable(page);

    await drag(
      page,
      await textPoint(fruitCell(page, "Apple"), 0.4),
      await textPoint(line(page, AFTER_FRUIT), 0.5),
    );

    await expect
      .poll(() =>
        fruitTable(page).evaluate((el) =>
          el.contains(getSelection()!.focusNode),
        ),
      )
      .toBe(true);
    const selected = await selectedText(page);
    expect(selected).toContain("Yellow");
    expect(selected).not.toContain("After");
    await expect(tables(page)).toHaveCount(2);

    await line(page, AFTER_FRUIT).click();
    await expect(editor(page)).toBeFocused();
    await appendToLine(page, `${AFTER_FRUIT}Z`);
    await expect(tables(page)).toHaveCount(2);
  });

  test("a press that moves only a few pixels still reveals the table", async ({
    page,
  }) => {
    await appendFruitTable(page);
    const { x, y } = await textPoint(fruitCell(page, "Red"), 0.5);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y);
    await page.mouse.up();

    await expectFruitRevealed(page);
    await expectCaretIn(line(page, "| Apple | Red |"));
  });

  test("after a drag selection Escape and typing go to the previous caret", async ({
    page,
  }) => {
    await appendFruitTable(page);
    const firstLine = pane(page).locator(".cm-line").first();

    await dragAcrossFruit(page);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toBeFocused();
    await expect.poll(() => selectedText(page)).toBe("");
    await page.keyboard.type("X");
    await expect(firstLine).toHaveText("X# Welcome");

    await dragAcrossFruit(page);
    await page.keyboard.type("Y");
    await expect(firstLine).toHaveText("XY# Welcome");
    await expect(editor(page)).toBeFocused();
    await expect(tables(page)).toHaveCount(2);
  });

  test("after a drag selection ArrowDown puts the caret below the table", async ({
    page,
  }) => {
    await appendFruitTable(page);
    await dragAcrossFruit(page);

    await page.keyboard.press("ArrowDown");
    await expect(editor(page)).toBeFocused();
    await expect(tables(page)).toHaveCount(2);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("Z");
    await expect(line(page, AFTER_FRUIT)).toHaveText(`Z${AFTER_FRUIT}`);
    await expect(tables(page)).toHaveCount(2);
  });

  test("the share viewer keeps native selection across table cells", async ({
    page,
  }) => {
    await openWelcomeNote(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const link = await createLink(page);
    const viewer = await page.context().newPage();
    await viewer.goto(link);
    const table = viewer.locator("table.cm-table");
    await expect(table).toBeVisible();

    await drag(
      viewer,
      await textPoint(
        table.getByRole("columnheader", { name: "Column A" }),
        0.3,
      ),
      await textPoint(table.getByRole("cell", { name: "2", exact: true }), 0.5),
    );

    const selected = await selectedText(viewer);
    expect(selected).toContain("Column B");
    expect(selected).toContain("1");
    await expect(table).toBeVisible();
    await expect(
      viewer.locator(".cm-line", { hasText: "| --- |" }),
    ).toHaveCount(0);
  });

  test("copying a drag across cells puts them on the clipboard as TSV and an HTML table", async ({
    page,
  }) => {
    await appendFruitTable(page);
    await recordCopy(page);

    await dragFruitWords(
      page,
      fruitCell(page, "Apple"),
      fruitCell(page, "Yellow"),
    );
    await page.keyboard.press("ControlOrMeta+c");
    await expect.poll(() => copiedData(page)).not.toBeNull();
    const body = await copiedData(page);

    expect(body?.text).toBe("Apple\tRed\nLemon\tYellow");
    expect(body?.html).toContain("<td>Apple</td><td>Red</td>");
    await expect(tables(page)).toHaveCount(2);

    await dragFruitWords(
      page,
      fruitTable(page).getByRole("columnheader", { name: "Fruit" }),
      fruitCell(page, "Red"),
    );
    await page.keyboard.press("ControlOrMeta+c");
    await expect
      .poll(async () => (await copiedData(page))?.text)
      .toBe("Fruit\tColour\nApple\tRed");
    expect((await copiedData(page))?.html).toContain("<th>Fruit</th>");
  });

  test("copying a selection inside one cell copies it natively", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await appendFruitTable(page);
    await recordCopy(page);

    await dragFruitWords(
      page,
      fruitCell(page, "Yellow"),
      fruitCell(page, "Yellow"),
    );
    await expect.poll(() => selectedText(page)).toBe("Yellow");
    await page.keyboard.press("ControlOrMeta+c");

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Yellow");
    const html = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return item.types.includes("text/html")
        ? (await item.getType("text/html")).text()
        : "";
    });
    expect(html).not.toContain("<table");
    expect((await copiedData(page))?.html).toBe("");
  });

  test("the share viewer copies selected cells as TSV", async ({ page }) => {
    await appendFruitTable(page);
    await flushPendingSaves(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const link = await createLink(page);
    const viewer = await page.context().newPage();
    await viewer.goto(link);
    const table = viewer.locator("table.cm-table").filter({
      has: viewer.getByRole("columnheader", { name: "Fruit" }),
    });
    await expect(table).toBeVisible();

    await expect(async () => {
      await drag(
        viewer,
        await textPoint(table.getByRole("cell", { name: "Apple" }), 0),
        await textPoint(table.getByRole("cell", { name: "Yellow" }), 1),
      );
      expect(await selectedText(viewer)).toContain("Lemon");
    }).toPass();
    await recordCopy(viewer);
    await viewer.keyboard.press("ControlOrMeta+c");
    await expect.poll(() => copiedData(viewer)).not.toBeNull();

    expect((await copiedData(viewer))?.text).toBe("Apple\tRed\nLemon\tYellow");
  });

  test(
    "a tap on a cell reveals the table",
    { tag: "@mobile-only" },
    async ({ page }) => {
      await appendFruitTable(page);

      await fruitCell(page, "Red").tap();

      await expectFruitRevealed(page);
    },
  );

  test(
    "a long press on a cell does not reveal the table",
    { tag: "@mobile-only" },
    async ({ page }) => {
      await appendFruitTable(page);
      const point = await textPoint(fruitCell(page, "Red"), 0.5);

      const finger = await TouchFinger.on(page);
      await finger.down(point);
      finger.hold(800);
      await finger.move(point, 1);
      await finger.up();

      await expect(tables(page)).toHaveCount(2);

      // Headless Chromium selects no word on a long press, so the selection
      // it would make is set directly.
      await editor(page).focus();
      await fruitCell(page, "Red").evaluate((cell) => {
        const text = cell.firstChild!;
        getSelection()!.setBaseAndExtent(text, 0, text, 3);
      });
      await expect
        .poll(() =>
          fruitTable(page).evaluate(
            (el) => document.activeElement === el.closest(".cm-table-widget"),
          ),
        )
        .toBe(true);
      await expect.poll(() => selectedText(page)).toBe("Red");
      await expect(tables(page)).toHaveCount(2);
    },
  );
});

test.describe("vim mode", () => {
  const gutter = (page: Page) => page.locator(".cm-relative-line-numbers");
  const position = (page: Page) => page.locator(".vim-status-bar .position");
  const commandInput = (page: Page) =>
    page.getByRole("textbox", { name: "Vim command" });
  const tableLabels = (page: Page) =>
    gutter(page).locator(".cm-table-line-numbers .cm-table-line-number");
  const lineLabels = (page: Page) =>
    gutter(page).locator(".cm-gutterElement:not(:has(.cm-table-line-numbers))");

  async function openVimWelcome(page: Page): Promise<void> {
    await openNotes(page);
    await enableVimMode(page);
    await openWelcome(page);
    await expect(modeText(page)).toHaveText("NORMAL");
    await expect(tables(page)).toHaveCount(1);
  }

  async function goToTaskLine(page: Page): Promise<void> {
    await openTaskLine(page).click();
    await expect(tables(page)).toHaveCount(1);
    await expect(
      gutter(page).locator(".cm-gutterElement.cm-relative-line-current"),
    ).toHaveCount(1);
  }

  async function currentLineNumber(page: Page): Promise<number> {
    const current = gutter(page).locator(".cm-relative-line-current");
    await expect(current).toHaveCount(1);
    return Number(await current.innerText());
  }

  async function appendZ(page: Page): Promise<void> {
    await page.keyboard.press("$");
    await page.keyboard.press("a");
    await page.keyboard.type("Z");
    await page.keyboard.press("Escape");
    await expect(modeText(page)).toHaveText("NORMAL");
  }

  async function landOn(page: Page, text: string): Promise<void> {
    await appendZ(page);
    await expect(line(page, `${text}Z`)).toHaveText(`${text}Z`);
    await page.keyboard.press("u");
    await expect(line(page, text)).toHaveText(text);
  }

  async function focusEditor(page: Page): Promise<void> {
    await editor(page).focus();
    await expect(editor(page)).toBeFocused();
  }

  async function addLinesBelowTable(page: Page): Promise<void> {
    await focusEditor(page);
    await page.keyboard.press("G");
    await page.keyboard.press("o");
    await page.keyboard.type("- after one");
    await page.keyboard.press("Escape");
    await page.keyboard.press("o");
    await page.keyboard.type("- after two");
    await page.keyboard.press("Escape");
    await expect(modeText(page)).toHaveText("NORMAL");
    await expect(tables(page)).toHaveCount(1);
  }

  interface Box {
    top: number;
    bottom: number;
  }

  async function measureTable(
    page: Page,
    index: number,
  ): Promise<{ labels: Box[]; rows: Box[] }> {
    return page.evaluate((i) => {
      const container = document.querySelectorAll(
        "#note-pane .cm-relative-line-numbers .cm-table-line-numbers",
      )[i];
      const table = document.querySelectorAll("#note-pane table.cm-table")[i];
      const textBox = (el: Element): Box => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const { top, bottom } = range.getBoundingClientRect();
        return { top, bottom };
      };
      const rowBox = (el: Element): Box => {
        const { top, bottom } = el.getBoundingClientRect();
        return { top, bottom };
      };
      return {
        labels: [...container.children].map(textBox),
        rows: [...table.querySelectorAll("tr")].map(rowBox),
      };
    }, index);
  }

  function misalignments(measured: { labels: Box[]; rows: Box[] }): string[] {
    const { labels, rows } = measured;
    const problems: string[] = [];
    if (labels.length !== rows.length + 1) {
      return [`${labels.length} labels for ${rows.length} rows`];
    }
    const centre = (box: Box) => (box.top + box.bottom) / 2;
    const within = (box: Box, row: Box) =>
      centre(box) >= row.top && centre(box) <= row.bottom;
    if (!within(labels[0], rows[0])) problems.push("header outside its row");
    if (labels[1].top < labels[0].bottom - 1) {
      problems.push("delimiter above the end of the header label");
    }
    for (let i = 2; i < labels.length; i++) {
      if (!within(labels[i], rows[i - 1])) {
        problems.push(`label ${i} outside its row`);
      }
    }
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].top <= labels[i - 1].top) {
        problems.push(`label ${i} does not sit below label ${i - 1}`);
      }
      if (labels[i].top < labels[i - 1].bottom - 1) {
        problems.push(`label ${i} overlaps label ${i - 1}`);
      }
    }
    return problems;
  }

  test(
    "every table line has a gutter number",
    { tag: "@mobile" },
    async ({ page }) => {
      await openVimWelcome(page);
      await goToTaskLine(page);

      await expect(gutter(page).locator(".cm-table-line-numbers")).toHaveCount(
        1,
      );
      await expect(tableLabels(page)).toHaveText(["2", "3", "4"]);
      await expect(lineLabels(page).last()).toHaveText("5");

      await page.keyboard.press("j");
      await expect(tableLabels(page)).toHaveText(["1", "2", "3"]);
      await expect(tables(page)).toHaveCount(1);
    },
  );

  test(
    "table line numbers sit on their rows",
    { tag: "@mobile" },
    async ({ page }) => {
      await openVimWelcome(page);
      await focusEditor(page);
      await page.keyboard.press("G");
      await page.keyboard.press("o");
      await page.keyboard.insertText(
        [
          row(["Name", "Notes"]),
          row(["---", "---"]),
          row(["first", "short"]),
          row(["second", LONG_TEXT]),
          row(["third", "short"]),
          "",
        ].join("\n"),
      );
      await page.keyboard.press("Escape");
      await expect(modeText(page)).toHaveText("NORMAL");
      await expect(tables(page)).toHaveCount(2);

      const wrapped = tables(page)
        .nth(1)
        .getByRole("cell", { name: LONG_TEXT });
      await expect
        .poll(() =>
          wrapped.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set([...range.getClientRects()].map((r) => r.top)).size;
          }),
        )
        .toBeGreaterThan(1);

      await expect(
        gutter(page).locator(".cm-table-line-numbers").nth(1),
      ).toBeAttached();
      await expect
        .poll(async () => misalignments(await measureTable(page, 1)))
        .toEqual([]);
    },
  );

  test(
    "nested table line numbers sit on their rows",
    { tag: "@mobile" },
    async ({ page }) => {
      await openVimWelcome(page);
      await focusEditor(page);
      await page.keyboard.press("G");
      await page.keyboard.press("o");
      await page.keyboard.insertText(
        [
          row(["Name", "Notes"]),
          row(["---", "---"]),
          row(["first", "short"]),
          row(["second", LONG_TEXT]),
          row(["third", "short"]),
          "",
        ]
          .map((text) => (text === "" ? text : `> ${text}`))
          .join("\n"),
      );
      await page.keyboard.press("Escape");
      await expect(modeText(page)).toHaveText("NORMAL");
      await expect(tables(page)).toHaveCount(2);
      await expect(
        tables(page)
          .nth(1)
          .locator("xpath=ancestor::*[contains(@class,'cm-table-quote')]"),
      ).toHaveCount(1);

      const wrapped = tables(page)
        .nth(1)
        .getByRole("cell", { name: LONG_TEXT });
      await expect
        .poll(() =>
          wrapped.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set([...range.getClientRects()].map((r) => r.top)).size;
          }),
        )
        .toBeGreaterThan(1);

      await expect(
        gutter(page).locator(".cm-table-line-numbers").nth(1),
      ).toBeAttached();
      await expect
        .poll(async () => misalignments(await measureTable(page, 1)))
        .toEqual([]);
    },
  );

  test("counted jumps land into the table", async ({ page }) => {
    await openVimWelcome(page);

    for (const [keys, text] of [
      ["2j", HEADER],
      ["3j", DELIMITER],
      ["4j", LAST_ROW],
    ] as const) {
      await goToTaskLine(page);
      await page.keyboard.type(keys);
      await expectRevealed(page);
      await landOn(page, text);
    }

    for (const [keys, text] of [
      ["2k", DELIMITER],
      ["3k", HEADER],
    ] as const) {
      await page.keyboard.press("G");
      await expect(tables(page)).toHaveCount(1);
      await page.keyboard.type(keys);
      await expectRevealed(page);
      await landOn(page, text);
    }

    await goToTaskLine(page);
    const taskLine = await currentLineNumber(page);
    await page.keyboard.press("G");
    await expect(tables(page)).toHaveCount(1);
    await page.keyboard.type("4k");
    await expect(position(page)).toHaveText(new RegExp(`^${taskLine + 1}:`));
    await expect(tables(page)).toHaveCount(1);
  });

  test("counted jumps go through and out of the table", async ({ page }) => {
    await openVimWelcome(page);
    await addLinesBelowTable(page);
    await expect(tableLabels(page)).toHaveText(["5", "4", "3"]);

    await goToTaskLine(page);
    await expect(tableLabels(page)).toHaveText(["2", "3", "4"]);
    await page.keyboard.type("6j");
    await expect(tables(page)).toHaveCount(1);
    await landOn(page, "- after one");

    await page.keyboard.press("G");
    await expect(tables(page)).toHaveCount(1);
    await page.keyboard.type("7k");
    await expect(tables(page)).toHaveCount(1);
    await appendZ(page);
    await expect(line(page, "Open taskZ")).toBeVisible();
    await page.keyboard.press("u");
    await expect(line(page, "Open taskZ")).toHaveCount(0);

    await goToTaskLine(page);
    await page.keyboard.type("3j");
    await expectRevealed(page);
    await page.keyboard.press("Escape");
    await page.keyboard.type("3j");
    await expect(tables(page)).toHaveCount(1);
    await landOn(page, "- after one");
  });

  test("NG and :N land on table lines", async ({ page }) => {
    await openVimWelcome(page);
    await goToTaskLine(page);
    await page.keyboard.type("2j");
    await expectRevealed(page);
    const header = await currentLineNumber(page);

    await goToTaskLine(page);
    await page.keyboard.type(`${header}G`);
    await expectRevealed(page);
    await expect(position(page)).toHaveText(`${header}:1`);
    await landOn(page, HEADER);

    await goToTaskLine(page);
    await page.keyboard.press(":");
    await expect(commandInput(page)).toBeFocused();
    await page.keyboard.type(String(header + 2));
    await page.keyboard.press("Enter");
    await expectRevealed(page);
    await expect(position(page)).toHaveText(new RegExp(`^${header + 2}:`));
    await landOn(page, LAST_ROW);
  });

  test("+, - and ArrowDown take a count", async ({ page }) => {
    await openVimWelcome(page);
    await goToTaskLine(page);
    const header = (await currentLineNumber(page)) + 2;

    await page.keyboard.type("2+");
    await expectRevealed(page);
    await expect(position(page)).toHaveText(`${header}:1`);
    await landOn(page, HEADER);

    await page.keyboard.press("G");
    await expect(tables(page)).toHaveCount(1);
    await page.keyboard.type("2-");
    await expectRevealed(page);
    await expect(position(page)).toHaveText(`${header + 1}:1`);
    await landOn(page, DELIMITER);

    await goToTaskLine(page);
    await page.keyboard.press("2");
    await page.keyboard.press("ArrowDown");
    await expectRevealed(page);
    await expect(position(page)).toHaveText(new RegExp(`^${header}:`));
    await landOn(page, HEADER);
  });

  test("gj and gk enter the table", async ({ page }) => {
    await openVimWelcome(page);
    await goToTaskLine(page);
    const header = (await currentLineNumber(page)) + 2;
    await page.keyboard.press("j");
    await expect(tables(page)).toHaveCount(1);

    await page.keyboard.type("gj");
    await expectRevealed(page);
    await expect(position(page)).toHaveText(new RegExp(`^${header}:`));
    await landOn(page, HEADER);

    await page.keyboard.press("G");
    await expect(tables(page)).toHaveCount(1);
    await page.keyboard.type("gk");
    await expectRevealed(page);
    await expect(position(page)).toHaveText(new RegExp(`^${header + 2}:`));
    await landOn(page, LAST_ROW);
  });

  test("an uncounted Ctrl+d lands inside a tall table", async ({ page }) => {
    const ROWS = 60;
    const lineNumberOf = async () => {
      await expect(position(page)).toHaveText(/^\d+:/);
      return Number((await position(page).innerText()).split(":")[0]);
    };
    const goToLine = async (n: number) => {
      await page.keyboard.press(":");
      await expect(commandInput(page)).toBeFocused();
      await page.keyboard.type(String(n));
      await page.keyboard.press("Enter");
      await expect(position(page)).toHaveText(new RegExp(`^${n}:`));
    };

    await openVimWelcome(page);
    await focusEditor(page);
    await page.keyboard.press("G");
    const welcomeEnd = await lineNumberOf();
    await page.keyboard.press("o");
    await page.keyboard.insertText(
      [
        ...Array.from({ length: 40 }, (_, i) => `Filler ${i + 1}`),
        "",
        "| A | B | C |",
        "| --- | --- | --- |",
        ...Array.from(
          { length: ROWS },
          (_, i) => `| r${i + 1} a | r${i + 1} b | r${i + 1} c |`,
        ),
        "",
        "After tall",
      ].join("\n"),
    );
    await page.keyboard.press("Escape");
    await expect(modeText(page)).toHaveText("NORMAL");
    const tallHeader = welcomeEnd + 42;
    await expect(position(page)).toHaveText(
      new RegExp(`^${tallHeader + ROWS + 3}:`),
    );

    await goToLine(welcomeEnd + 2);
    const fillerTop = (n: number) =>
      pane(page)
        .locator(".cm-line", { hasText: new RegExp(`^Filler ${n}$`) })
        .evaluate((el) => el.getBoundingClientRect().top);
    await expect
      .poll(async () => (await fillerTop(3)) - (await fillerTop(2)))
      .toBeGreaterThan(0);
    const lineHeight = (await fillerTop(3)) - (await fillerTop(2));
    const paneHeight = () =>
      page.locator(".note-content").evaluate((el) => el.clientHeight);
    await expect.poll(paneHeight).toBeGreaterThan(lineHeight);
    const half = Math.round((await paneHeight()) / (2 * lineHeight));

    const start = tallHeader - Math.floor(half / 2);
    await goToLine(start);
    await page.keyboard.type("zt");
    await page.keyboard.press("Control+d");

    await expect
      .poll(async () => Math.abs((await lineNumberOf()) - (start + half)))
      .toBeLessThanOrEqual(1);
    const landed = await lineNumberOf();
    const rowNumber = landed - tallHeader - 1;
    expect(rowNumber).toBeGreaterThanOrEqual(1);
    expect(rowNumber).toBeLessThanOrEqual(ROWS);
    await expect(tables(page)).toHaveCount(1);
    await expect(
      pane(page).locator(".cm-line", {
        hasText: new RegExp(
          `^\\| r${rowNumber} a \\| r${rowNumber} b \\| r${rowNumber} c \\|$`,
        ),
      }),
    ).toBeVisible();
  });

  test("a click on a cell reveals the table in normal mode", async ({
    page,
  }) => {
    await openVimWelcome(page);

    await tables(page).getByRole("cell", { name: "1", exact: true }).click();

    await expectRevealed(page);
    await expect(modeText(page)).toHaveText("NORMAL");
  });

  test("copying table cells fills the Vim register", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openVimWelcome(page);
    await focusEditor(page);
    await page.keyboard.press("G");
    await page.keyboard.press("o");
    await page.keyboard.insertText([...FRUIT, "", AFTER_FRUIT].join("\n"));
    await page.keyboard.press("Escape");
    await page.keyboard.type("gg");
    await expect(tables(page)).toHaveCount(2);

    await dragFruitWords(
      page,
      fruitCell(page, "Apple"),
      fruitCell(page, "Yellow"),
    );
    await page.keyboard.press("ControlOrMeta+c");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Apple\tRed\nLemon\tYellow");

    await line(page, AFTER_FRUIT)
      .locator("xpath=preceding-sibling::*[1]")
      .click();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("p");

    await expect
      .poll(async () =>
        (await pane(page).locator(".cm-line").allTextContents()).join("\n"),
      )
      .toContain("Apple\tRed\nLemon\tYellow\n" + AFTER_FRUIT);
  });

  test("after a drag selection keys act from the previous cursor", async ({
    page,
  }) => {
    await openVimWelcome(page);
    await focusEditor(page);
    await page.keyboard.press("G");
    await page.keyboard.press("o");
    await page.keyboard.insertText([...FRUIT, "", AFTER_FRUIT].join("\n"));
    await page.keyboard.press("Escape");
    await page.keyboard.type("gg");
    await expect(tables(page)).toHaveCount(2);
    const secondLine = pane(page).locator(".cm-line").nth(1);

    await dragAcrossFruit(page);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toBeFocused();
    await expect(modeText(page)).toHaveText("NORMAL");

    await dragAcrossFruit(page);
    await page.keyboard.press("j");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("i");
    await expect(modeText(page)).toHaveText("INSERT");
    await page.keyboard.type("Q");
    await page.keyboard.press("Escape");
    await expect(secondLine).toHaveText("Q");
    await expect(tables(page)).toHaveCount(2);

    await dragAcrossFruit(page);
    await line(page, AFTER_FRUIT).click();
    await expect(editor(page)).toBeFocused();
    await expect(modeText(page)).toHaveText("NORMAL");
    await page.keyboard.press("i");
    await page.keyboard.type("W");
    await expect(line(page, "After")).toHaveText(/^After fr.*W/);
    await expect(tables(page)).toHaveCount(2);
  });
});

test.describe("page motions", () => {
  const ROWS = 60;
  const TALL_HEADER = "| A | B | C |";
  const FIRST_FILLER = 1;
  const FIRST_TAIL = 105;
  const TALL_HEADER_OFFSET = 42;

  interface Box {
    top: number;
    bottom: number;
  }

  interface Layout {
    lines: Array<Box & { text: string }>;
    rows: Box[];
  }

  const tallRow = (r: number) =>
    r === 0 ? TALL_HEADER : `| r${r} a | r${r} b | r${r} c |`;
  const exactLine = (page: Page, text: string) =>
    pane(page).locator(".cm-line", {
      hasText: new RegExp(`^${text.replace(/[|]/g, "\\|")}$`),
    });
  const position = (page: Page) => page.locator(".vim-status-bar .position");

  async function insertTallNote(page: Page): Promise<void> {
    await page.keyboard.insertText(
      [
        ...Array.from({ length: 40 }, (_, i) => `Filler ${i + 1}`),
        "",
        TALL_HEADER,
        "| --- | --- | --- |",
        ...Array.from({ length: ROWS }, (_, i) => tallRow(i + 1)),
        "",
        ...Array.from({ length: 40 }, (_, i) => `Tail ${i + 1}`),
      ].join("\n"),
    );
  }

  async function openTallNote(page: Page): Promise<void> {
    await openWelcomeNote(page);
    await editor(page).focus();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await insertTallNote(page);
    await expect(exactLine(page, "Tail 40")).toBeVisible();
  }

  async function openVimTallNote(page: Page): Promise<number> {
    await openNotes(page);
    await enableVimMode(page);
    await openWelcome(page);
    await expect(modeText(page)).toHaveText("NORMAL");
    await editor(page).focus();
    await page.keyboard.press("G");
    await expect(position(page)).toHaveText(/^\d+:/);
    const welcomeEnd = Number((await position(page).innerText()).split(":")[0]);
    await page.keyboard.press("o");
    await insertTallNote(page);
    await page.keyboard.press("Escape");
    await expect(modeText(page)).toHaveText("NORMAL");
    await expect(exactLine(page, "Tail 40")).toBeVisible();
    return welcomeEnd;
  }

  function measure(page: Page): Promise<Layout> {
    return page.evaluate(() => {
      const box = (el: Element): Box => {
        const { top, bottom } = el.getBoundingClientRect();
        return { top, bottom };
      };
      const root = document.querySelector("#note-pane")!;
      const lines = [...root.querySelectorAll(".cm-line")]
        .filter((el) => /^(Filler|Tail) \d+$/.test(el.textContent ?? ""))
        .map((el) => ({ text: el.textContent ?? "", ...box(el) }));
      const table = [...root.querySelectorAll("table.cm-table")].find((t) =>
        t.textContent?.includes("r1 a"),
      );
      const rows = table ? [...table.querySelectorAll("tr")].map(box) : [];
      return { lines, rows };
    });
  }

  function pageHeight(page: Page, vim: boolean): Promise<number> {
    return vim
      ? page.locator(".note-content").evaluate((el) => el.clientHeight)
      : page.evaluate(() => window.innerHeight - 5);
  }

  function targetY(line: Box, forward: boolean, height: number): number {
    return forward ? line.bottom + height : line.top - height;
  }

  function rowAt(rows: Box[], y: number): number {
    const index = rows.findIndex((row) => row.bottom > y);
    return index === -1 ? rows.length - 1 : index;
  }

  // CodeMirror keeps a viewport while it still covers the visible part of the
  // note, so one that stops short of the table needs a further scroll.
  async function nudge(page: Page, forward: boolean): Promise<void> {
    await page
      .locator(".note-content")
      .evaluate((el, by) => el.scrollBy(0, by), forward ? 40 : -40);
  }

  async function chooseStart(
    page: Page,
    prefix: "Filler" | "Tail",
    forward: boolean,
    height: number,
    row: number | null,
  ): Promise<string> {
    let start: string | null = null;
    await expect
      .poll(async () => {
        const { lines, rows } = await measure(page);
        if (rows.length !== ROWS + 1) {
          await nudge(page, forward);
          return null;
        }
        const hits = lines
          .filter((l) => l.text.startsWith(`${prefix} `))
          .map((l) => {
            const y = targetY(l, forward, height);
            const index = rows.findIndex((r) => r.top <= y && y < r.bottom);
            const target = rows[index];
            const offset = target
              ? Math.abs(y - (target.top + target.bottom) / 2)
              : Infinity;
            return { text: l.text, index, offset };
          })
          .filter((hit) => (row === null ? hit.index >= 1 : hit.index === row));
        if (row !== null) hits.sort((a, b) => a.offset - b.offset);
        start = hits[0]?.text ?? null;
        if (!start) await nudge(page, forward);
        return start;
      })
      .not.toBeNull();
    return start!;
  }

  async function expectedRow(
    page: Page,
    startText: string,
    forward: boolean,
    height: number,
  ): Promise<number> {
    let expected = -1;
    await expect
      .poll(async () => {
        const { lines, rows } = await measure(page);
        const start = lines.find((l) => l.text === startText);
        if (!start || rows.length !== ROWS + 1) return -1;
        const y = targetY(start, forward, height);
        expected = y < rows[0].top ? -1 : rowAt(rows, y);
        return expected;
      })
      .toBeGreaterThanOrEqual(0);
    return expected;
  }

  async function expectRowRevealed(page: Page, row: number): Promise<void> {
    await expect(tables(page).filter({ hasText: "r1 a" })).toHaveCount(0);
    await expect(exactLine(page, tallRow(row))).toBeVisible();
  }

  async function landedRow(page: Page): Promise<number> {
    await expect(tables(page).filter({ hasText: "r1 a" })).toHaveCount(0);
    await page.keyboard.press("End");
    await page.keyboard.type("Z");
    const marked = pane(page).locator(".cm-line", { hasText: /Z$/ });
    await expect(marked).toHaveCount(1);
    const text = (await marked.innerText()).slice(0, -1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(marked).toHaveCount(0);
    const row =
      text === TALL_HEADER ? 0 : Number(/^\| r(\d+) a/.exec(text)?.[1]);
    expect(row).toBeGreaterThanOrEqual(0);
    return row;
  }

  // CodeMirror draws only a margin beyond the visible part of the note, and
  // that margin is widest in the direction of the last long scroll, which is
  // where the page motion aims.
  async function scrollLineTo(
    page: Page,
    text: string,
    block: "start" | "end",
  ): Promise<void> {
    await exactLine(page, text).evaluate(
      (el, b) => el.scrollIntoView({ block: b }),
      block,
    );
  }

  async function placeCaret(page: Page, text: string): Promise<void> {
    await exactLine(page, text).click();
    await page.keyboard.press("End");
  }

  async function pageFrom(
    page: Page,
    prefix: "Filler" | "Tail",
    key: "PageDown" | "PageUp",
    row: number | null,
  ): Promise<{ expected: number; landed: number }> {
    const forward = key === "PageDown";
    await openTallNote(page);
    if (forward) {
      await page.keyboard.press("ControlOrMeta+Home");
      await placeCaret(page, "Filler 1");
      await scrollLineTo(page, "Filler 8", "start");
    } else {
      await placeCaret(page, "Tail 1");
      await scrollLineTo(page, "Tail 1", "end");
    }
    const height = await pageHeight(page, false);
    const start = await chooseStart(page, prefix, forward, height, row);
    await placeCaret(page, start);
    const expected = await expectedRow(page, start, forward, height);
    await page.keyboard.press(key);
    const landed = await landedRow(page);
    await expectRowRevealed(page, landed);
    return { expected, landed };
  }

  test("PageDown from a line above lands on the row at the page height", async ({
    page,
  }) => {
    const { expected, landed } = await pageFrom(page, "Filler", "PageDown", 5);
    expect(Math.abs(landed - expected)).toBeLessThanOrEqual(1);
  });

  test("PageUp from a line below lands on the row at the page height", async ({
    page,
  }) => {
    const { expected, landed } = await pageFrom(page, "Tail", "PageUp", null);
    expect(expected).toBeGreaterThanOrEqual(1);
    expect(Math.abs(landed - expected)).toBeLessThanOrEqual(1);
  });

  test("PageDown onto the header row lands on the header line", async ({
    page,
  }) => {
    const { expected, landed } = await pageFrom(page, "Filler", "PageDown", 0);
    expect(expected).toBe(0);
    expect(landed).toBe(0);
  });

  test.describe("vim", () => {
    const commandInput = (page: Page) =>
      page.getByRole("textbox", { name: "Vim command" });

    async function lineNumber(page: Page): Promise<number> {
      await expect(position(page)).toHaveText(/^\d+:/);
      return Number((await position(page).innerText()).split(":")[0]);
    }

    async function goToLine(page: Page, n: number): Promise<void> {
      await page.keyboard.press(":");
      await expect(commandInput(page)).toBeFocused();
      await page.keyboard.type(String(n));
      await page.keyboard.press("Enter");
      await expect(position(page)).toHaveText(new RegExp(`^${n}:`));
    }

    function lineOf(welcomeEnd: number, text: string): number {
      const [prefix, n] = text.split(" ");
      return (
        welcomeEnd +
        Number(n) -
        1 +
        (prefix === "Filler" ? FIRST_FILLER : FIRST_TAIL)
      );
    }

    async function prepare(
      page: Page,
      prefix: "Filler" | "Tail",
      forward: boolean,
      vimHeight: boolean,
      row: number | null,
    ): Promise<{ header: number; start: number; expected: number }> {
      const welcomeEnd = await openVimTallNote(page);
      if (forward) {
        await goToLine(page, lineOf(welcomeEnd, "Filler 8"));
        await scrollLineTo(page, "Filler 8", "start");
      } else {
        await exactLine(page, "Tail 1").click();
        await expect(position(page)).toHaveText(
          new RegExp(`^${lineOf(welcomeEnd, "Tail 1")}:`),
        );
        await scrollLineTo(page, "Tail 1", "end");
      }
      const height = await pageHeight(page, vimHeight);
      const text = await chooseStart(page, prefix, forward, height, row);
      const start = lineOf(welcomeEnd, text);
      await goToLine(page, start);
      const expected = await expectedRow(page, text, forward, height);
      return { header: welcomeEnd + TALL_HEADER_OFFSET, start, expected };
    }

    async function expectLanded(
      page: Page,
      header: number,
      start: number,
      expected: number,
    ): Promise<number> {
      await expect.poll(() => lineNumber(page)).not.toBe(start);
      const landed = await lineNumber(page);
      const row = landed === header ? 0 : landed - header - 1;
      expect(Math.abs(row - expected)).toBeLessThanOrEqual(1);
      await expectRowRevealed(page, row);
      return landed;
    }

    test("Ctrl+f lands on the row at the pane height and keeps the column", async ({
      page,
    }) => {
      const { header, start, expected } = await prepare(
        page,
        "Filler",
        true,
        true,
        5,
      );
      for (let i = 0; i < 3; i++) await page.keyboard.press("l");
      await expect(position(page)).toHaveText(`${start}:4`);
      await page.keyboard.press("Control+f");
      const landed = await expectLanded(page, header, start, expected);
      await expect(position(page)).toHaveText(`${landed}:4`);
    });

    test("PageUp from a line below lands in the table", async ({ page }) => {
      const { header, start, expected } = await prepare(
        page,
        "Tail",
        false,
        true,
        null,
      );
      await page.keyboard.press("PageUp");
      await expectLanded(page, header, start, expected);
      await expect(modeText(page)).toHaveText("NORMAL");
    });

    test("Ctrl+f without a table in reach moves by one pane", async ({
      page,
    }) => {
      const welcomeEnd = await openVimTallNote(page);
      const start = lineOf(welcomeEnd, "Filler 1");
      await goToLine(page, start);
      await page.keyboard.type("zt");
      const fillerTop = (n: number) =>
        exactLine(page, `Filler ${n}`).evaluate(
          (el) => el.getBoundingClientRect().top,
        );
      await expect
        .poll(async () => (await fillerTop(3)) - (await fillerTop(2)))
        .toBeGreaterThan(0);
      const lineHeight = (await fillerTop(3)) - (await fillerTop(2));
      const lines = (await pageHeight(page, true)) / lineHeight;

      await page.keyboard.press("Control+f");

      await expect.poll(() => lineNumber(page)).not.toBe(start);
      const landed = await lineNumber(page);
      expect(landed).toBeLessThanOrEqual(lineOf(welcomeEnd, "Filler 40"));
      expect(Math.abs(landed - start - lines)).toBeLessThanOrEqual(2);
    });

    test("PageDown in insert mode lands in the table", async ({ page }) => {
      const { header, start, expected } = await prepare(
        page,
        "Filler",
        true,
        false,
        5,
      );
      await page.keyboard.press("A");
      await expect(modeText(page)).toHaveText("INSERT");
      await page.keyboard.press("PageDown");
      await expectLanded(page, header, start, expected);
      await expect(modeText(page)).toHaveText("INSERT");
    });
  });
});
