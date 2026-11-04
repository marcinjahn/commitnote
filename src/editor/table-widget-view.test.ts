// @vitest-environment jsdom
import type { Extension } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { imageSource } from "./image-widgets";
import { tableWidgets } from "./table-widgets";

let editor: MarkdownEditor | null = null;
let parent: HTMLElement | null = null;

function setup(
  text: string,
  readOnly = false,
  extra: Extension[] = [],
): MarkdownEditor {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  editor = createMarkdownEditor({
    parent,
    text,
    readOnly,
    onChange: () => {},
    extensions: [tableWidgets(), ...extra],
  });
  return editor;
}

function renderedTable(
  text: string,
  readOnly = false,
  extra: Extension[] = [],
): HTMLTableElement {
  setup(`Intro\n\n${text}`, readOnly, extra);
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

  describe("cell images", () => {
    const cat = "| a |\n| - |\n| ![A cat](image:abcdefghijklmnopqrstuvwxyz) |";

    it("marks an image unavailable and shows its alt text without an image source", () => {
      const table = renderedTable(cat);

      const image = table.querySelector<HTMLElement>("td span.cm-table-image");
      expect(image?.dataset.state).toBe("unavailable");
      expect(image?.dataset.imageId).toBe("abcdefghijklmnopqrstuvwxyz");
      expect(image?.querySelector("img")?.alt).toBe("A cat");
      expect(image?.querySelector(".cm-table-image-alt")?.textContent).toBe(
        "A cat",
      );
    });

    it("loads the image through the image source", async () => {
      const table = renderedTable(cat, false, [
        imageSource.of(() => Promise.resolve({ url: "blob:x" })),
      ]);
      const image = table.querySelector<HTMLElement>("td .cm-table-image");

      await vi.waitFor(() =>
        expect(image?.querySelector("img")?.getAttribute("src")).toBe("blob:x"),
      );
      expect(image?.dataset.state).toBe("loading");
    });

    it("discards a result that arrives after the editor is destroyed", async () => {
      let resolve: (value: { url: string }) => void = () => {};
      const pending = new Promise<{ url: string }>((r) => (resolve = r));
      const table = renderedTable(cat, false, [imageSource.of(() => pending)]);
      const img = table.querySelector("img");

      editor?.destroy();
      resolve({ url: "blob:x" });
      await pending;
      await Promise.resolve();

      expect(img?.hasAttribute("src")).toBe(false);
    });

    it("sizes a reference with dimensions to the maximum height", () => {
      vi.stubGlobal("devicePixelRatio", 1);
      try {
        const table = renderedTable(
          "| a |\n| - |\n| ![A cat](image:abcdefghijklmnopqrstuvwxyz#800x600) |",
        );
        const img = table.querySelector("img");

        expect(parseFloat(img?.style.width ?? "")).toBeCloseTo(
          (160 * 800) / 600,
        );
        expect(img?.style.aspectRatio).not.toBe("");
      } finally {
        vi.unstubAllGlobals();
      }
    });
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

describe("TableWidget nested DOM", () => {
  function nestedWidget(text: string): HTMLElement {
    setup(`Intro\n\n${text}`);
    const found = parent?.querySelector<HTMLElement>(".cm-table-widget");
    if (!found) throw new Error("table widget not rendered");
    return found;
  }

  function cells(widget: HTMLElement): string[] {
    return Array.from(widget.querySelectorAll("th, td"), (c) => c.textContent);
  }

  it("renders a blockquote table with one quote bar and no indent", () => {
    const widget = nestedWidget("> | a | b |\n> | - | - |\n> | 1 | 2 |");

    expect(widget.querySelectorAll(".cm-table-quote")).toHaveLength(1);
    expect(widget.querySelector(".cm-table-indent")).toBeNull();
    expect(
      widget.querySelector(
        ".cm-table-widget > .cm-table-quote > .cm-table-nest > .cm-table-scroller > table.cm-table",
      ),
    ).not.toBeNull();
    expect(cells(widget)).toEqual(["a", "b", "1", "2"]);
  });

  it("nests one quote bar per blockquote level", () => {
    const widget = nestedWidget("> > | a | b |\n> > | - | - |\n> > | 1 | 2 |");
    const quotes = widget.querySelectorAll(".cm-table-quote");

    expect(quotes).toHaveLength(2);
    expect(quotes[1]?.parentElement).toBe(quotes[0]);
    expect(widget.querySelector(".cm-table-indent")).toBeNull();
    expect(cells(widget)).toEqual(["a", "b", "1", "2"]);
  });

  it("offsets a list table by its indent text without a quote bar", () => {
    const widget = nestedWidget(
      "- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |",
    );
    const indent = widget.querySelector(".cm-table-indent");

    expect(widget.querySelector(".cm-table-quote")).toBeNull();
    expect(indent?.textContent).toBe("  ");
    expect(indent?.getAttribute("aria-hidden")).toBe("true");
    expect(cells(widget)).toEqual(["a", "b", "1", "2"]);
  });

  it("combines a quote bar with an indent", () => {
    const widget = nestedWidget(">   | a | b |\n>   | - | - |\n>   | 1 | 2 |");
    const indent = widget.querySelector(".cm-table-indent");

    expect(widget.querySelectorAll(".cm-table-quote")).toHaveLength(1);
    expect(indent?.textContent).toBe("  ");
    expect(indent?.getAttribute("aria-hidden")).toBe("true");
    expect(cells(widget)).toEqual(["a", "b", "1", "2"]);
  });

  it("keeps a top-level table directly in its scroller", () => {
    const widget = nestedWidget("| a | b |\n| - | - |\n| 1 | 2 |");

    expect(widget.querySelector(".cm-table-quote, .cm-table-nest")).toBeNull();
    expect(
      widget.querySelector(
        ".cm-table-widget > .cm-table-scroller > table.cm-table",
      ),
    ).not.toBeNull();
  });
});
