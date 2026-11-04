// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { tableSelectionClipboard } from "./table-selection";
import { tableWidgets } from "./table-widgets";

let editor: MarkdownEditor | null = null;
let parent: HTMLElement | null = null;

function renderedTable(text: string, readOnly = false): HTMLTableElement {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  editor = createMarkdownEditor({
    parent,
    text: `Intro\n\n${text}`,
    readOnly,
    onChange: () => {},
    extensions: [tableWidgets()],
  });
  const found = parent.querySelector<HTMLTableElement>("table.cm-table");
  if (!found) throw new Error("table widget not rendered");
  return found;
}

afterEach(() => {
  editor?.destroy();
  parent?.remove();
  editor = null;
  parent = null;
  document.getSelection()?.removeAllRanges();
});

const FRUIT =
  "| Fruit | Colour |\n| - | - |\n| Apple | Red |\n| Lemon | Yellow |";

function cell(table: HTMLTableElement, text: string): HTMLElement {
  const found = Array.from(
    table.querySelectorAll<HTMLElement>("th, td"),
    (el) => el,
  ).find((el) => el.textContent === text);
  if (!found) throw new Error(`no cell ${text}`);
  return found;
}

function textNode(el: HTMLElement): Node {
  const node = el.firstChild;
  if (!node) throw new Error("empty cell");
  return node;
}

function rangeBetween(
  from: HTMLElement,
  fromOffset: number,
  to: HTMLElement,
  toOffset: number,
): Range {
  const range = document.createRange();
  range.setStart(textNode(from), fromOffset);
  range.setEnd(textNode(to), toOffset);
  return range;
}

function select(range: Range): void {
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("tableSelectionClipboard", () => {
  it("copies whole cells of one row as tab-separated text", () => {
    const table = renderedTable(FRUIT);

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(cell(table, "Apple"), 0, cell(table, "Red"), 3),
    );

    expect(copied?.text).toBe("Apple\tRed");
    expect(copied?.html).toBe(
      "<table><tr><td>Apple</td><td>Red</td></tr></table>",
    );
  });

  it("clips the first and last cells to the range", () => {
    const table = renderedTable(FRUIT);

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(cell(table, "Apple"), 2, cell(table, "Red"), 2),
    );

    expect(copied?.text).toBe("ple\tRe");
  });

  it("puts every touched row on its own line and keeps header cells as th", () => {
    const table = renderedTable(FRUIT);

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(cell(table, "Fruit"), 0, cell(table, "Red"), 3),
    );

    expect(copied?.text).toBe("Fruit\tColour\nApple\tRed");
    expect(copied?.html).toBe(
      "<table><tr><th>Fruit</th><th>Colour</th></tr>" +
        "<tr><td>Apple</td><td>Red</td></tr></table>",
    );
  });

  it("includes the cells between the two ends of a multi-row range", () => {
    const table = renderedTable(FRUIT);

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(cell(table, "Red"), 0, cell(table, "Lemon"), 5),
    );

    expect(copied?.text).toBe("Red\nLemon");
  });

  it("escapes markup in the html and leaves the text unchanged", () => {
    const table = renderedTable('| a | b |\n| - | - |\n| a < b & "c" | x |');

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(cell(table, 'a < b & "c"'), 0, cell(table, "x"), 1),
    );

    expect(copied?.text).toBe('a < b & "c"\tx');
    expect(copied?.html).toContain(
      "<td>a &lt; b &amp; &quot;c&quot;</td><td>x</td>",
    );
  });

  it("copies the visible text of a formatted cell", () => {
    const table = renderedTable(
      "| a | b |\n| - | - |\n| **bold** and [link](https://example.com) | x |",
    );
    const formatted = table.querySelector<HTMLElement>("tbody td");

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(
        formatted!.querySelector("strong") as HTMLElement,
        0,
        cell(table, "x"),
        1,
      ),
    );

    expect(copied?.text).toBe("bold and link\tx");
  });

  it("copies a cell image as its alt text", () => {
    const table = renderedTable(
      "| a | b |\n| - | - |\n| ![a cat](image:abcdefghijklmnopqrstuvwxyz) | x |",
    );
    const range = document.createRange();
    range.setStart(table.querySelector("tbody td")!, 0);
    range.setEnd(textNode(cell(table, "x")), 1);

    const copied = tableSelectionClipboard(table, range);

    expect(copied?.text).toBe("a cat\tx");
  });

  it("replaces tabs and newlines in a cell with spaces", () => {
    const table = renderedTable("| a | b |\n| - | - |\n| p\tq | x |");

    const copied = tableSelectionClipboard(
      table,
      rangeBetween(cell(table, "p\tq"), 0, cell(table, "x"), 1),
    );

    expect(copied?.text).toBe("p q\tx");
  });

  it("returns null for a range within one cell", () => {
    const table = renderedTable(FRUIT);

    expect(
      tableSelectionClipboard(
        table,
        rangeBetween(cell(table, "Apple"), 1, cell(table, "Apple"), 4),
      ),
    ).toBeNull();
  });
});

describe("table copy listener", () => {
  function copyOn(target: Element): {
    event: ClipboardEvent;
    setData: ReturnType<typeof vi.fn>;
    reachedDocument: ReturnType<typeof vi.fn>;
  } {
    const setData = vi.fn();
    const reachedDocument = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    document.addEventListener("copy", reachedDocument);
    target.dispatchEvent(event);
    document.removeEventListener("copy", reachedDocument);
    return { event: event as ClipboardEvent, setData, reachedDocument };
  }

  it.each([false, true])(
    "writes both formats for a multi-cell selection (readOnly: %s)",
    (readOnly) => {
      const table = renderedTable(FRUIT, readOnly);
      select(rangeBetween(cell(table, "Apple"), 0, cell(table, "Yellow"), 6));

      const { event, setData, reachedDocument } = copyOn(cell(table, "Apple"));

      expect(setData).toHaveBeenCalledWith(
        "text/plain",
        "Apple\tRed\nLemon\tYellow",
      );
      expect(setData).toHaveBeenCalledWith(
        "text/html",
        expect.stringContaining("<td>Apple</td><td>Red</td>"),
      );
      expect(event.defaultPrevented).toBe(true);
      expect(reachedDocument).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves a single-cell selection to the browser", () => {
    const table = renderedTable(FRUIT);
    select(rangeBetween(cell(table, "Apple"), 0, cell(table, "Apple"), 3));

    const { event, setData } = copyOn(cell(table, "Apple"));

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a selection that reaches outside the table to the browser", () => {
    const table = renderedTable(FRUIT);
    const range = document.createRange();
    range.setStart(textNode(cell(table, "Apple")), 0);
    const content = editor!.view.contentDOM;
    range.setEnd(content, content.childNodes.length);
    select(range);

    const { event, setData } = copyOn(cell(table, "Apple"));

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
