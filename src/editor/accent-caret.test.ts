// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CaretBlinker, accentCaret, type CaretLight } from "./accent-caret";
import { setVimStatus, vimStatusField } from "./vim/vim-status";
import { CARET_BLINK_MS, CARET_HOLD_MS } from "./caret-style";

describe("CaretBlinker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function blinker(reducedMotion = false) {
    const lights: CaretLight[] = [];
    const instance = new CaretBlinker(
      (light) => lights.push(light),
      () => reducedMotion,
    );
    return { instance, lights };
  }

  it("holds the caret solid, then blinks off and on at the shared rhythm", () => {
    const { instance, lights } = blinker();

    instance.restart();
    vi.advanceTimersByTime(CARET_HOLD_MS - 1);
    expect(instance.light).toBe("solid");

    vi.advanceTimersByTime(1);
    expect(instance.light).toBe("off");

    vi.advanceTimersByTime(CARET_BLINK_MS);
    expect(instance.light).toBe("on");

    vi.advanceTimersByTime(CARET_BLINK_MS);
    expect(lights).toEqual(["off", "on", "off"]);
  });

  it("goes solid again and restarts the hold on every restart", () => {
    const { instance } = blinker();

    instance.restart();
    vi.advanceTimersByTime(CARET_HOLD_MS);
    expect(instance.light).toBe("off");

    instance.restart();
    expect(instance.light).toBe("solid");
    vi.advanceTimersByTime(CARET_HOLD_MS - 1);
    expect(instance.light).toBe("solid");
  });

  it("stays solid with reduced motion", () => {
    const { instance, lights } = blinker(true);

    instance.restart();
    vi.advanceTimersByTime(CARET_HOLD_MS + 5 * CARET_BLINK_MS);

    expect(instance.light).toBe("solid");
    expect(lights).toEqual([]);
  });

  it("stops blinking when stopped", () => {
    const { instance } = blinker();

    instance.restart();
    vi.advanceTimersByTime(CARET_HOLD_MS);
    instance.stop();
    vi.advanceTimersByTime(5 * CARET_BLINK_MS);

    expect(instance.light).toBe("solid");
  });
});

describe("accentCaret", () => {
  function createView(editable: boolean): EditorView {
    return new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "hello",
        extensions: [accentCaret(), EditorView.editable.of(editable)],
      }),
    });
  }

  it("hides the browser caret in an editable editor", () => {
    const view = createView(true);

    expect(view.contentDOM.classList.contains("cm-own-caret")).toBe(true);
    view.destroy();
  });

  it("leaves a read-only editor alone", () => {
    const view = createView(false);

    expect(view.contentDOM.classList.contains("cm-own-caret")).toBe(false);
    view.destroy();
  });

  it("hands the caret back to the browser during IME composition", () => {
    const view = createView(true);

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(view.contentDOM.classList.contains("cm-own-caret")).toBe(false);

    view.destroy();
  });

  describe("with a vim status", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function createVimView(): EditorView {
      const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
          doc: "hello",
          extensions: [accentCaret(), vimStatusField],
        }),
      });
      vi.spyOn(view, "hasFocus", "get").mockReturnValue(true);
      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        left: 10,
        right: 10,
        top: 0,
        bottom: 20,
      });
      view.dispatch({ selection: { anchor: 2 } });
      return view;
    }

    const drawnCarets = (view: EditorView) => {
      vi.advanceTimersByTime(50);
      return view.dom.querySelectorAll(
        ".cm-accent-caret-layer .cm-accent-caret",
      ).length;
    };
    const ownsCaret = (view: EditorView) =>
      view.contentDOM.classList.contains("cm-own-caret");
    const enter = (view: EditorView, mode: "insert" | "visual") =>
      view.dispatch({ effects: setVimStatus.of({ mode }) });

    it("leaves the caret to the vim cursor in normal mode", () => {
      const view = createVimView();

      expect(drawnCarets(view)).toBe(0);
      expect(ownsCaret(view)).toBe(false);
      view.destroy();
    });

    it("draws the caret in insert mode", () => {
      const view = createVimView();

      enter(view, "insert");

      expect(drawnCarets(view)).toBe(1);
      expect(ownsCaret(view)).toBe(true);
      view.destroy();
    });

    it("clears the caret again when switching to visual mode", () => {
      const view = createVimView();
      enter(view, "insert");

      enter(view, "visual");

      expect(drawnCarets(view)).toBe(0);
      expect(ownsCaret(view)).toBe(false);
      view.destroy();
    });
  });
});
