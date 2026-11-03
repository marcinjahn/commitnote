// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { tableWidgets } from "./table-widgets";

let editor: MarkdownEditor | null = null;
let parent: HTMLElement | null = null;

function setup(text: string, readOnly = false): MarkdownEditor {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  editor = createMarkdownEditor({
    parent,
    text,
    readOnly,
    onChange: () => {},
    extensions: [tableWidgets()],
  });
  return editor;
}

function renderedTable(text: string, readOnly = false): HTMLTableElement {
  setup(`Intro\n\n${text}`, readOnly);
  const found = parent?.querySelector<HTMLTableElement>(
    ".cm-table-widget > .cm-table-scroller > table.cm-table",
  );
  if (!found) throw new Error("table widget not rendered");
  return found;
}

afterEach(() => {
  editor?.destroy();
  parent?.remove();
  editor = null;
  parent = null;
});

describe("TableWidget DOM", () => {
  it("renders a table inside a table scroller inside the table widget", () => {
    const table = renderedTable("| a | b |\n| - | - |\n| 1 | 2 |");

    expect(table.closest(".cm-table-scroller")?.parentElement).toHaveProperty(
      "className",
      "cm-table-widget",
    );
    const headers = table.querySelectorAll("thead > tr > th[scope=col]");
    expect(Array.from(headers, (th) => th.textContent)).toEqual(["a", "b"]);
    expect(table.querySelectorAll("tbody > tr")).toHaveLength(1);
  });

  it("omits the tbody for a table without body rows", () => {
    const table = renderedTable("| a | b |\n| - | - |");

    expect(table.querySelectorAll("th")).toHaveLength(2);
    expect(table.querySelector("tbody")).toBeNull();
  });

  it("gives every body row the header's column count", () => {
    const table = renderedTable(
      "| a | b | c |\n| - | - | - |\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |",
    );
    const rows = table.querySelectorAll("tbody > tr");

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelectorAll("td")).toHaveLength(3);
    }
    expect(Array.from(rows[1]?.children ?? [], (td) => td.textContent)).toEqual(
      ["1", "2", "3"],
    );
  });

  it("aligns only the aligned columns", () => {
    const table = renderedTable(
      "| l | c | r | n |\n| :- | :-: | -: | - |\n| 1 | 2 | 3 | 4 |",
    );

    for (const row of table.querySelectorAll("tr")) {
      const cells = Array.from(
        row.children,
        (cell) => (cell as HTMLElement).style.textAlign,
      );
      expect(cells).toEqual(["left", "center", "right", ""]);
    }
  });

  it("renders inline cell content", () => {
    const table = renderedTable(
      "| a | b |\n| - | - |\n| **bold** | [site](https://example.com) |",
    );

    expect(table.querySelector("td strong")?.textContent).toBe("bold");
    const link = table.querySelector<HTMLElement>(
      "td .cm-table-link[data-url]",
    );
    expect(link?.dataset.url).toBe("https://example.com");
    expect(link?.textContent).toBe("site");
  });

  it("shows an escaped pipe as a pipe", () => {
    const table = renderedTable("| a |\n| - |\n| x \\| y |");

    expect(table.querySelector("td")?.textContent).toBe("x | y");
  });

  it("shows an image reference as its alt text without an img", () => {
    const table = renderedTable(
      "| a |\n| - |\n| ![A cat](image:abcdefghijklmnopqrstuvwxyz#800x600) |",
    );

    expect(table.querySelector("td")?.textContent).toBe("A cat");
    expect(table.querySelector("img")).toBeNull();
  });

  it("renders in a read-only editor with the cursor inside the table", () => {
    setup("| a | b |\n| - | - |\n| 1 | 2 |", true);

    expect(parent?.querySelector("table.cm-table")).not.toBeNull();
  });

  it("keeps words whole in cells despite the editor's line wrapping", () => {
    const table = renderedTable("| September 2026 |\n| - |\n| 1 |");

    expect(table.closest(".cm-lineWrapping")).not.toBeNull();
    for (const cell of table.querySelectorAll("th, td")) {
      expect(getComputedStyle(cell).wordBreak).toBe("normal");
      expect(getComputedStyle(cell).overflowWrap).toBe("break-word");
    }
  });

  it("keeps the table's width out of the editor content's sizing", () => {
    const table = renderedTable("| a |\n| - |\n| 1 |");
    const scroller = table.closest(".cm-table-scroller");

    expect(scroller).not.toBeNull();
    expect(getComputedStyle(scroller!).contain).toBe("inline-size");
  });

  it("sets no aria-hidden anywhere in the widget", () => {
    renderedTable("| a | b |\n| - | - |\n| *x* | `y` |");
    const widget = parent?.querySelector(".cm-table-widget");

    expect(widget?.hasAttribute("aria-hidden")).toBe(false);
    expect(widget?.querySelector("[aria-hidden]")).toBeNull();
  });
});
