// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { linkOpen } from "./link-open";
import { livePreview } from "./live-preview";

const TEXT = "see [site](https://example.com/a) and [bad](javascript:alert(1)) end";
const LINK_POS = TEXT.indexOf("site");
const BAD_POS = TEXT.indexOf("bad");
const PLAIN_POS = TEXT.length - 1;

interface Setup {
  readonly editor: MarkdownEditor;
  readonly parent: HTMLElement;
  readonly open: ReturnType<typeof vi.fn<(url: string) => void>>;
  readonly changes: string[];
}

let current: Setup | null = null;

function setup(
  options: { readOnly?: boolean; defaultOpener?: boolean } = {},
): Setup {
  const changes: string[] = [];
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const open = vi.fn<(url: string) => void>();
  const editor = createMarkdownEditor({
    parent,
    text: TEXT,
    readOnly: options.readOnly ?? false,
    onChange: (next) => changes.push(next),
    extensions: [
      livePreview(),
      options.defaultOpener ? linkOpen() : linkOpen({ open }),
    ],
  });
  current = { editor, parent, open, changes };
  return current;
}

function mouse(
  type: string,
  target: HTMLElement,
  init: MouseEventInit = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function key(type: string, target: HTMLElement, init: KeyboardEventInit): void {
  target.dispatchEvent(
    new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
  );
}

function hitAt(s: Setup, pos: number | null): void {
  vi.spyOn(s.editor.view, "posAtCoords").mockReturnValue(pos);
}

afterEach(() => {
  vi.restoreAllMocks();
  current?.editor.destroy();
  current?.parent.remove();
  current = null;
});

describe("linkOpen", () => {
  it("opens the URL on Ctrl+mousedown over a link", () => {
    const s = setup();
    hitAt(s, LINK_POS);
    const event = mouse("mousedown", s.editor.view.contentDOM, {
      ctrlKey: true,
    });
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.open).toHaveBeenCalledWith("https://example.com/a");
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens the URL on Meta+mousedown over a link", () => {
    const s = setup();
    hitAt(s, LINK_POS);
    const event = mouse("mousedown", s.editor.view.contentDOM, {
      metaKey: true,
    });
    expect(s.open).toHaveBeenCalledWith("https://example.com/a");
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores a plain mousedown on a link", () => {
    const s = setup();
    hitAt(s, LINK_POS);
    mouse("mousedown", s.editor.view.contentDOM);
    expect(s.open).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+mousedown with a non-primary button", () => {
    const s = setup();
    hitAt(s, LINK_POS);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true, button: 1 });
    expect(s.open).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+mousedown outside any link", () => {
    const s = setup();
    hitAt(s, PLAIN_POS);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true });
    expect(s.open).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+mousedown when the pointer is not over the editor text", () => {
    const s = setup();
    hitAt(s, null);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true });
    expect(s.open).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+mousedown on an unsafe link", () => {
    const s = setup();
    hitAt(s, BAD_POS);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true });
    expect(s.open).not.toHaveBeenCalled();
  });

  it("leaves the document and selection untouched", () => {
    const s = setup();
    const before = s.editor.view.state.selection;
    hitAt(s, LINK_POS);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true });
    const after = s.editor.view.state.selection;
    expect(s.editor.view.state.doc.toString()).toBe(TEXT);
    expect(after.ranges).toHaveLength(before.ranges.length);
    expect(after.main.anchor).toBe(before.main.anchor);
    expect(after.main.head).toBe(before.main.head);
    expect(s.changes).toEqual([]);
  });

  it("prevents Ctrl+click on a link but not a plain click", () => {
    const s = setup();
    hitAt(s, LINK_POS);
    expect(
      mouse("click", s.editor.view.contentDOM, { ctrlKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(mouse("click", s.editor.view.contentDOM).defaultPrevented).toBe(
      false,
    );
  });

  it("opens links in a read-only editor", () => {
    const s = setup({ readOnly: true });
    hitAt(s, LINK_POS);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true });
    expect(s.open).toHaveBeenCalledWith("https://example.com/a");
  });

  it("falls back to window.open with noopener and noreferrer", () => {
    const spy = vi.spyOn(window, "open").mockReturnValue(null);
    const s = setup({ defaultOpener: true });
    hitAt(s, LINK_POS);
    mouse("mousedown", s.editor.view.contentDOM, { ctrlKey: true });
    expect(spy).toHaveBeenCalledWith(
      "https://example.com/a",
      "_blank",
      "noopener,noreferrer",
    );
  });

  describe("armed class", () => {
    const ARMED = "cm-link-open-armed";

    it("toggles with the modifier key", () => {
      const s = setup();
      const { contentDOM, dom } = s.editor.view;
      key("keydown", contentDOM, { ctrlKey: true });
      expect(dom.classList.contains(ARMED)).toBe(true);
      key("keyup", contentDOM, { ctrlKey: false });
      expect(dom.classList.contains(ARMED)).toBe(false);
    });

    it("is set by mousemove with Meta held", () => {
      const s = setup();
      mouse("mousemove", s.editor.view.contentDOM, { metaKey: true });
      expect(s.editor.view.dom.classList.contains(ARMED)).toBe(true);
    });

    it("is removed on blur", () => {
      const s = setup();
      const { contentDOM, dom } = s.editor.view;
      key("keydown", contentDOM, { ctrlKey: true });
      contentDOM.dispatchEvent(new FocusEvent("blur"));
      expect(dom.classList.contains(ARMED)).toBe(false);
    });

    it("is removed when the pointer leaves", () => {
      const s = setup();
      const { contentDOM, dom } = s.editor.view;
      key("keydown", contentDOM, { ctrlKey: true });
      contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
      expect(dom.classList.contains(ARMED)).toBe(false);
    });
  });
});
