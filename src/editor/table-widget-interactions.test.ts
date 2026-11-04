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
  type: "mousedown" | "mouseup" | "click" | "mousemove",
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

function touchDown(target: Element, timeStamp: number): void {
  const event = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerType: "touch",
  });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
}

function clickAt(
  target: Element,
  init: MouseEventInit & { timeStamp?: number },
) {
  const { timeStamp, ...rest } = init;
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...rest,
  });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
  }
  target.dispatchEvent(event);
  return event;
}

describe("table widget mousedown", () => {
  it("leaves a plain mousedown to the browser so a drag can select text", () => {
    setup(`${INTRO}${TABLE}`);

    expect(mouse("mousedown", cellAt(1, 0)).defaultPrevented).toBe(false);
  });

  it("prevents the default of a touch press in an editable editor", () => {
    setup(`${INTRO}${TABLE}`);
    touchDown(cellAt(1, 0), 0);

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

  it("prevents dragging the table's content", () => {
    setup(`${INTRO}${TABLE}`);
    const event = new Event("dragstart", { bubbles: true, cancelable: true });

    cellAt(1, 0).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("table widget press and release", () => {
  it("reveals the table when the pointer moved only a few pixels", () => {
    setup(`${INTRO}${TABLE}`);

    mouse("mousedown", cellAt(1, 0), { clientX: 10, clientY: 10 });
    clickAt(cellAt(1, 0), { clientX: 12, clientY: 10 });

    expect(widget()).toBeNull();
  });

  it("keeps the table and the selection after a drag", () => {
    const ed = setup(`${INTRO}${TABLE}`);
    ed.setSelection(2, 2);

    mouse("mousedown", cellAt(1, 0), { clientX: 10, clientY: 10 });
    const event = clickAt(cellAt(1, 1), { clientX: 16, clientY: 10 });

    expect(event.defaultPrevented).toBe(false);
    expect(ed.getSelection()).toEqual({ anchor: 2, head: 2 });
    expect(widget()).not.toBeNull();
  });

  it("reveals the table on a short tap", () => {
    setup(`${INTRO}${TABLE}`);

    touchDown(cellAt(1, 0), 1000);
    mouse("mousedown", cellAt(1, 0));
    clickAt(cellAt(1, 0), { timeStamp: 1100 });

    expect(widget()).toBeNull();
  });

  it("keeps the table after a long press", () => {
    const ed = setup(`${INTRO}${TABLE}`);

    touchDown(cellAt(1, 0), 1000);
    mouse("mousedown", cellAt(1, 0));
    clickAt(cellAt(1, 0), { timeStamp: 1500 });

    expect(ed.getSelection().anchor).toBe(0);
    expect(widget()).not.toBeNull();
  });
});

describe("table widget drag selection seed", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "caretPositionFromPoint");
  });

  function stubCarets(): void {
    const carets = [
      { x: 10, node: cellAt(1, 0).firstChild! },
      { x: 30, node: cellAt(1, 1).firstChild! },
    ];
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: (x: number) => {
        const caret = carets.find((entry) => entry.x === x);
        return caret ? { offsetNode: caret.node, offset: 0 } : null;
      },
    });
  }

  function move(x: number, buttons: number): void {
    mouse("mousemove", cellAt(1, 1), { clientX: x, clientY: 10, buttons });
  }

  it("turns a collapsed drag into a range from the press point", () => {
    setup(`${INTRO}${TABLE}`);
    stubCarets();
    getSelection()?.removeAllRanges();

    mouse("mousedown", cellAt(1, 0), { clientX: 10, clientY: 10 });
    move(30, 1);

    const selection = getSelection();
    expect(selection?.anchorNode).toBe(cellAt(1, 0).firstChild);
    expect(selection?.focusNode).toBe(cellAt(1, 1).firstChild);
  });

  it("leaves the selection alone within the click slop and after release", () => {
    setup(`${INTRO}${TABLE}`);
    stubCarets();
    getSelection()?.removeAllRanges();

    mouse("mousedown", cellAt(1, 0), { clientX: 10, clientY: 10 });
    move(12, 1);
    expect(getSelection()?.rangeCount).toBe(0);

    mouse("mouseup", cellAt(1, 0), { clientX: 12, clientY: 10 });
    move(30, 1);
    expect(getSelection()?.rangeCount).toBe(0);
  });
});

describe("table widget focus", () => {
  it("makes the editable wrapper focusable by script only", () => {
    setup(`${INTRO}${TABLE}`);

    expect(widget()?.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves the read-only wrapper unfocusable", () => {
    setup(`${INTRO}${TABLE}`, { readOnly: true });

    expect(widget()?.hasAttribute("tabindex")).toBe(false);
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

describe("table text selection", () => {
  const OUTRO = "\n\nOutro";

  function selectionChange(): void {
    document.dispatchEvent(new Event("selectionchange"));
  }

  function outroText(): Node {
    const line = [...(parent?.querySelectorAll(".cm-line") ?? [])].find(
      (element) => element.textContent === "Outro",
    );
    if (!line?.firstChild) throw new Error("outro not found");
    return line.firstChild;
  }

  function introText(): Node {
    const line = parent?.querySelector(".cm-line");
    if (!line?.firstChild) throw new Error("intro not found");
    return line.firstChild;
  }

  it("clamps a selection leaving the table to the table's end", () => {
    setup(`${INTRO}${TABLE}${OUTRO}`);
    const table = query("table.cm-table");

    getSelection()?.setBaseAndExtent(
      cellAt(1, 0).firstChild!,
      0,
      outroText(),
      2,
    );
    selectionChange();

    const selection = getSelection();
    expect(selection?.anchorNode).toBe(cellAt(1, 0).firstChild);
    expect(selection?.focusNode).toBe(table);
    expect(selection?.focusOffset).toBe(table.childNodes.length);
  });

  it("clamps a selection leaving the table upwards to the table's start", () => {
    setup(`${INTRO}${TABLE}${OUTRO}`);
    const table = query("table.cm-table");

    getSelection()?.setBaseAndExtent(
      cellAt(1, 0).firstChild!,
      1,
      introText(),
      1,
    );
    selectionChange();

    expect(getSelection()?.focusNode).toBe(table);
    expect(getSelection()?.focusOffset).toBe(0);
  });

  it("leaves a read-only selection alone", () => {
    setup(`${INTRO}${TABLE}${OUTRO}`, { readOnly: true });

    getSelection()?.setBaseAndExtent(
      cellAt(1, 0).firstChild!,
      0,
      outroText(),
      2,
    );
    selectionChange();

    expect(getSelection()?.focusNode).toBe(outroText());
  });

  it("moves focus to the table wrapper without changing the selection", () => {
    const ed = setup(`${INTRO}${TABLE}${OUTRO}`);
    ed.setSelection(2, 2);
    ed.view.contentDOM.focus();
    const from = cellAt(1, 0).firstChild!;
    const to = cellAt(1, 1).firstChild!;

    getSelection()?.setBaseAndExtent(from, 0, to, 1);
    selectionChange();

    expect(document.activeElement).toBe(widget());
    expect(getSelection()?.anchorNode).toBe(from);
    expect(getSelection()?.focusNode).toBe(to);
    expect(ed.getSelection()).toEqual({ anchor: 2, head: 2 });
  });
});

describe("table wrapper keys", () => {
  const OUTRO = "\n\nOutro";

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const wrapper = widget();
    if (!wrapper) throw new Error("widget not found");
    wrapper.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    wrapper.dispatchEvent(event);
    return event;
  }

  it("puts the caret on the line after the table on ArrowDown", () => {
    const ed = setup(`${INTRO}${TABLE}${OUTRO}`);

    const event = press("ArrowDown");

    const after = INTRO.length + TABLE.length + 1;
    expect(event.defaultPrevented).toBe(true);
    expect(ed.getSelection()).toEqual({ anchor: after, head: after });
    expect(widget()).not.toBeNull();
    expect(document.activeElement).toBe(ed.view.contentDOM);
  });

  it("puts the caret at the end of the line before the table on ArrowLeft", () => {
    const ed = setup(`${INTRO}${TABLE}${OUTRO}`);

    press("ArrowLeft");

    const before = INTRO.length - 1;
    expect(ed.getSelection()).toEqual({ anchor: before, head: before });
    expect(widget()).not.toBeNull();
  });

  it("reveals the table at its end when no line follows it", () => {
    const ed = setup(`${INTRO}${TABLE}`);
    ed.setSelection(2, 2);

    press("ArrowRight");

    expect(ed.getSelection().anchor).toBe(INTRO.length + TABLE.length);
    expect(widget()).toBeNull();
  });

  it("reveals the table at its start when no line precedes it", () => {
    const ed = setup(`${TABLE}${OUTRO}`);
    ed.setSelection(TABLE.length + 2, TABLE.length + 2);

    press("ArrowUp");

    expect(ed.getSelection().anchor).toBe(0);
    expect(widget()).toBeNull();
  });

  it("hands Escape to the editor at its unchanged selection", () => {
    const ed = setup(`${INTRO}${TABLE}${OUTRO}`);
    ed.setSelection(2, 2);

    press("Escape", { keyCode: 27 });

    expect(document.activeElement).toBe(ed.view.contentDOM);
    expect(ed.getSelection()).toEqual({ anchor: 2, head: 2 });
    expect(widget()).not.toBeNull();
  });

  it("runs other keys in the editor from its previous selection", () => {
    const ed = setup(`${INTRO}${TABLE}${OUTRO}`);
    ed.setSelection(2, 2);

    const event = press("Enter", { keyCode: 13 });

    expect(event.defaultPrevented).toBe(true);
    expect(ed.view.state.doc.toString()).toBe(`In\ntro\n\n${TABLE}${OUTRO}`);
  });

  it.each([
    ["Control+C", { key: "c", ctrlKey: true }],
    ["Meta+C", { key: "c", metaKey: true }],
    ["Control+Insert", { key: "Insert", ctrlKey: true }],
    ["Shift", { key: "Shift", shiftKey: true }],
  ])("keeps focus on the table for %s", (_name, init) => {
    setup(`${INTRO}${TABLE}${OUTRO}`);

    const event = press(init.key, init);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(widget());
  });
});
