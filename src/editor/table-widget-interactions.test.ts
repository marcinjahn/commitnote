// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { tableWidgets } from "./table-widgets";

const INTRO = "Intro\n\n";
const TABLE = "| a | b |\n| - | - |\n| 1 | 2 |";

let editor: MarkdownEditor | null = null;
let parent: HTMLElement | null = null;

function setup(
  text: string,
  options: { readOnly?: boolean; open?: (url: string) => void } = {},
): MarkdownEditor {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  editor = createMarkdownEditor({
    parent,
    text,
    readOnly: options.readOnly ?? false,
    onChange: () => {},
    extensions: [tableWidgets({ open: options.open })],
  });
  return editor;
}

function query<T extends Element>(selector: string): T {
  const found = parent?.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} not found`);
  return found;
}

function widget(): HTMLElement | null {
  return parent?.querySelector<HTMLElement>(".cm-table-widget") ?? null;
}

function mouse(
  type: "mousedown" | "click" | "mousemove",
  target: Element,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function cellAt(row: number, column: number): HTMLElement {
  const cells = parent?.querySelectorAll<HTMLElement>("table.cm-table tr");
  const cell = cells?.[row]?.children[column];
  if (!(cell instanceof HTMLElement)) throw new Error("cell not found");
  return cell;
}

afterEach(() => {
  vi.unstubAllGlobals();
  editor?.destroy();
  parent?.remove();
  editor = null;
  parent = null;
});

describe("table widget click placement", () => {
  it("puts the caret at the end of a filled cell and reveals the table", () => {
    const text = `${INTRO}${TABLE}`;
    const ed = setup(text);

    const event = mouse("click", cellAt(1, 1));

    const caret = text.indexOf("2 |") + 1;
    expect(ed.getSelection()).toEqual({ anchor: caret, head: caret });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ed.view.contentDOM);
    expect(widget()).toBeNull();
  });

  it("places the caret before trailing spaces of a cell", () => {
    const text = `${INTRO}| a   | b |\n| --- | - |\n| 1   | 2 |`;
    const ed = setup(text);

    mouse("click", cellAt(1, 0));

    const caret = text.indexOf("1   |") + 1;
    expect(ed.getSelection().anchor).toBe(caret);
  });

  it("places the caret after the pipe and space of an empty cell", () => {
    const text = `${INTRO}| a | b |\n| - | - |\n|  | 2 |`;
    const ed = setup(text);

    mouse("click", cellAt(1, 0));

    expect(ed.getSelection().anchor).toBe(text.indexOf("|  | 2") + 2);
  });

  it("places the caret at the row end for a padding cell", () => {
    const text = `${INTRO}| a | b |\n| - | - |\n| 1 |\n\nOutro`;
    const ed = setup(text);

    mouse("click", cellAt(1, 1));

    expect(ed.getSelection().anchor).toBe(text.indexOf("| 1 |") + 5);
  });

  it("goes to the first cell of the nearest row when the click misses cells", () => {
    const text = `${INTRO}${TABLE}\n| 3 | 4 |`;
    const ed = setup(text);
    const rows = parent?.querySelectorAll<HTMLElement>("tr") ?? [];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () =>
        ({ top: index * 10, bottom: index * 10 + 10 }) as DOMRect;
    });

    mouse("click", query("tbody"), { clientY: 24 });

    expect(ed.getSelection().anchor).toBe(text.indexOf("3 |") + 1);
  });

  it("goes to the first row's first cell when nothing is measurable", () => {
    const text = `${INTRO}${TABLE}`;
    const ed = setup(text);

    mouse("click", query("table"), { clientY: 500 });

    expect(ed.getSelection().anchor).toBe(text.indexOf("a |") + 1);
  });

  it("still maps correctly after text was inserted above the table", () => {
    const text = `${INTRO}${TABLE}`;
    const ed = setup(text);
    const cell = cellAt(1, 0);
    ed.view.dispatch({ changes: { from: 0, insert: "Added line\n\n" } });

    mouse("click", cell);

    expect(ed.getSelection().anchor).toBe(
      "Added line\n\n".length + text.indexOf("1 |") + 1,
    );
  });

  it("ignores a click with a non-primary button", () => {
    const ed = setup(`${INTRO}${TABLE}`);

    mouse("click", cellAt(1, 0), { button: 2 });

    expect(ed.getSelection().anchor).toBe(0);
    expect(widget()).not.toBeNull();
  });

  it("does nothing when the widget position cannot be resolved", () => {
    const ed = setup(`${INTRO}${TABLE}`);
    const cell = cellAt(1, 0);
    vi.spyOn(ed.view, "posAtDOM").mockImplementation(() => {
      throw new RangeError("not in view");
    });

    const event = mouse("click", cell);

    expect(ed.getSelection().anchor).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    expect(widget()).not.toBeNull();
  });
});

describe("table widget in a read-only editor", () => {
  it("ignores a plain click", () => {
    const ed = setup(`${INTRO}${TABLE}`, { readOnly: true });
    const before = ed.getSelection();

    const event = mouse("click", cellAt(1, 0));

    expect(ed.getSelection()).toEqual(before);
    expect(event.defaultPrevented).toBe(false);
    expect(widget()).not.toBeNull();
  });
});

describe("table widget mousedown", () => {
  it("prevents the default of a plain mousedown in an editable editor", () => {
    setup(`${INTRO}${TABLE}`);

    expect(mouse("mousedown", cellAt(1, 0)).defaultPrevented).toBe(true);
  });

  it("leaves a plain mousedown alone in a read-only editor", () => {
    setup(`${INTRO}${TABLE}`, { readOnly: true });

    expect(mouse("mousedown", cellAt(1, 0)).defaultPrevented).toBe(false);
  });

  it("ignores a non-primary mousedown", () => {
    setup(`${INTRO}${TABLE}`);

    expect(
      mouse("mousedown", cellAt(1, 0), { button: 2 }).defaultPrevented,
    ).toBe(false);
  });
});

describe("table widget links", () => {
  const LINKED = `${INTRO}| a | b |\n| - | - |\n| [site](https://example.com) | x |`;

  it.each([
    ["editable", false, { ctrlKey: true }],
    ["editable", false, { metaKey: true }],
    ["read-only", true, { ctrlKey: true }],
    ["read-only", true, { metaKey: true }],
  ])(
    "opens a cell link on a modifier mousedown in a %s editor",
    (_name, readOnly, modifier) => {
      const open = vi.fn();
      const ed = setup(LINKED, { readOnly, open });
      const before = ed.getSelection();

      const down = mouse("mousedown", query(".cm-table-link"), modifier);
      const click = mouse("click", query(".cm-table-link"), modifier);

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith("https://example.com");
      expect(down.defaultPrevented).toBe(true);
      expect(click.defaultPrevented).toBe(true);
      expect(ed.getSelection()).toEqual(before);
      expect(widget()).not.toBeNull();
    },
  );

  it("does not open a link on a plain mousedown", () => {
    const open = vi.fn();
    setup(LINKED, { open });

    mouse("mousedown", query(".cm-table-link"));

    expect(open).not.toHaveBeenCalled();
  });

  it("opens nothing for a modifier mousedown outside a link", () => {
    const open = vi.fn();
    setup(LINKED, { open });

    mouse("mousedown", cellAt(1, 1), { ctrlKey: true });

    expect(open).not.toHaveBeenCalled();
  });

  it("toggles the armed class on the editor with the modifier key", () => {
    const ed = setup(LINKED);

    mouse("mousemove", cellAt(1, 0), { ctrlKey: true });
    expect(ed.view.dom.classList.contains("cm-link-open-armed")).toBe(true);

    mouse("mousemove", cellAt(1, 0));
    expect(ed.view.dom.classList.contains("cm-link-open-armed")).toBe(false);
  });
});

describe("table scroller focusability", () => {
  const created: FakeResizeObserver[] = [];

  function tableObservers(): FakeResizeObserver[] {
    return created.filter((observer) =>
      observer.observed.some((element) =>
        element.classList.contains("cm-table-scroller"),
      ),
    );
  }

  class FakeResizeObserver {
    readonly observed: Element[] = [];
    readonly disconnect = vi.fn();

    constructor(readonly callback: () => void) {
      created.push(this);
    }

    observe(element: Element): void {
      this.observed.push(element);
    }
  }

  function stubWidths(
    scroller: HTMLElement,
    scrollWidth: number,
    clientWidth: number,
  ): void {
    Object.defineProperty(scroller, "scrollWidth", {
      configurable: true,
      value: scrollWidth,
    });
    Object.defineProperty(scroller, "clientWidth", {
      configurable: true,
      value: clientWidth,
    });
  }

  function notify(): void {
    for (const observer of tableObservers()) observer.callback();
  }

  afterEach(() => {
    created.length = 0;
  });

  it("makes an overflowing read-only scroller a focusable region", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    setup(`${INTRO}${TABLE}`, { readOnly: true });
    const scroller = query<HTMLElement>(".cm-table-scroller");
    expect(scroller.hasAttribute("tabindex")).toBe(false);
    expect(tableObservers()).toHaveLength(1);
    expect(tableObservers()[0]?.observed).toEqual([scroller, query("table")]);

    stubWidths(scroller, 600, 300);
    notify();
    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(scroller.getAttribute("role")).toBe("region");
    expect(scroller.getAttribute("aria-label")).toBe("Table");

    stubWidths(scroller, 300, 300);
    notify();
    expect(scroller.hasAttribute("tabindex")).toBe(false);
    expect(scroller.hasAttribute("role")).toBe(false);
    expect(scroller.hasAttribute("aria-label")).toBe(false);
  });

  it("never makes an editable scroller focusable", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    setup(`${INTRO}${TABLE}`);
    const scroller = query<HTMLElement>(".cm-table-scroller");
    stubWidths(scroller, 600, 300);

    notify();

    expect(tableObservers()).toHaveLength(0);
    expect(scroller.hasAttribute("tabindex")).toBe(false);
    expect(scroller.hasAttribute("role")).toBe(false);
  });

  it("disconnects the observer when the widget is destroyed", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const ed = setup(`${INTRO}${TABLE}`, { readOnly: true });
    const observer = tableObservers()[0];
    expect(observer?.disconnect).not.toHaveBeenCalled();

    ed.view.dispatch({
      changes: { from: 0, to: ed.view.state.doc.length, insert: "plain" },
    });

    expect(widget()).toBeNull();
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("renders without a ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    setup(`${INTRO}${TABLE}`, { readOnly: true });

    expect(query(".cm-table-scroller").hasAttribute("tabindex")).toBe(false);
  });
});
