// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, vim } from "@replit/codemirror-vim";
import { useNoteScroller, verticalScroller } from "./vim-scroller";

const SCROLLER_TOP = 50;
const CONTENT_TOP = 30;
const CLIENT_TOP = 2;
const SCROLL_TOP = 400;
const OFFSET = CONTENT_TOP - SCROLLER_TOP + SCROLL_TOP - CLIENT_TOP;

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

function define(el: object, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(el, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

function rectAt(top: number): () => DOMRect {
  return () => ({ top }) as DOMRect;
}

function setup(options: { selfOverflow?: boolean } = {}) {
  const outer = document.createElement("div");
  outer.style.overflowY = "auto";
  const parent = document.createElement("div");
  outer.append(parent);
  document.body.append(outer);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "one\ntwo\nthree", extensions: [vim()] }),
  });
  cleanup.push(() => {
    view.destroy();
    outer.remove();
  });
  define(outer, {
    scrollTop: SCROLL_TOP,
    scrollHeight: 3000,
    clientHeight: 600,
    clientTop: CLIENT_TOP,
    getBoundingClientRect: rectAt(SCROLLER_TOP),
  });
  define(view.scrollDOM, {
    scrollHeight: options.selfOverflow ? 900 : 300,
    clientHeight: 300,
    scrollLeft: 7,
    scrollWidth: 1200,
    clientWidth: 500,
  });
  define(view.contentDOM, { getBoundingClientRect: rectAt(CONTENT_TOP) });
  return { outer, view };
}

function adapterOf(view: EditorView) {
  const cm = getCM(view);
  if (!cm) throw new Error("vim is not attached");
  useNoteScroller(cm, view);
  return cm;
}

describe("verticalScroller", () => {
  it("picks the scrolling ancestor when the editor does not overflow", () => {
    const { outer, view } = setup();
    expect(verticalScroller(view)).toBe(outer);
  });

  it("picks the editor's own scroller when it overflows", () => {
    const { view } = setup({ selfOverflow: true });
    expect(verticalScroller(view)).toBe(view.scrollDOM);
  });

  it("falls back to the editor's own scroller without a scrolling ancestor", () => {
    const { outer, view } = setup();
    outer.style.overflowY = "visible";
    expect(verticalScroller(view)).toBe(view.scrollDOM);
  });
});

describe("useNoteScroller", () => {
  it("reports the scroll position relative to the content and the pane's size", () => {
    const { view } = setup();
    const info = adapterOf(view).getScrollInfo();

    expect(info.top).toBe(SCROLL_TOP - OFFSET);
    expect(info.clientHeight).toBe(600);
    expect(info.height).toBe(3000);
    expect(info.left).toBe(7);
    expect(info.width).toBe(1200);
    expect(info.clientWidth).toBe(500);
  });

  it("scrolls the pane so that the content-relative y is at its top", () => {
    const { outer, view } = setup();
    adapterOf(view).scrollTo(null, 120);

    expect(outer.scrollTop).toBe(120 + OFFSET);
    expect(view.scrollDOM.scrollLeft).toBe(7);
  });

  it("scrolls horizontally through the editor's own scroller only", () => {
    const { outer, view } = setup();
    adapterOf(view).scrollTo(25, null);

    expect(view.scrollDOM.scrollLeft).toBe(25);
    expect(outer.scrollTop).toBe(SCROLL_TOP);
  });
});
