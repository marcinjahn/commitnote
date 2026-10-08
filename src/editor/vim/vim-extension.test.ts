// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Vim, getCM } from "@replit/codemirror-vim";
import { markdownEditorExtensions } from "../create-markdown-editor";
import { livePreview } from "../live-preview";
import { linkOpen } from "../link-open";
import { accentCaret } from "../accent-caret";
import {
  resetEditingMode,
  vimCallbacks,
  vimEnterInsert,
  vimEscape,
  vimExtension,
  type VimExtensionOptions,
} from "./vim-extension";
import { setVimStatus, vimStatusOf, type VimStatus } from "./vim-status";

const DOC = "first line\nsecond line\nthird line";

const views: EditorView[] = [];

interface Setup {
  readonly view: EditorView;
  readonly compartment: Compartment;
  readonly statuses: VimStatus[];
  readonly options: VimExtensionOptions;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function create(
  overrides: Partial<VimExtensionOptions> = {},
  extra: Extension = [],
): Setup {
  const statuses: VimStatus[] = [];
  const options: VimExtensionOptions = {
    initialMode: "normal",
    animatedCaret: true,
    onWrite: async () => {},
    onQuit: () => {},
    onStatus: (status) => statuses.push(status),
    ...overrides,
  };
  const compartment = new Compartment();
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: DOC,
      extensions: [
        markdownEditorExtensions(),
        livePreview(),
        linkOpen({ open: () => {} }),
        accentCaret(),
        extra,
        compartment.of(vimExtension(options)),
      ],
    }),
  });
  views.push(view);
  return { view, compartment, statuses, options };
}

async function setup(
  overrides: Partial<VimExtensionOptions> = {},
  extra: Extension = [],
): Promise<Setup> {
  const result = create(overrides, extra);
  await settle();
  return result;
}

function cmOf(view: EditorView) {
  const cm = getCM(view);
  if (!cm) throw new Error("vim is not attached");
  return cm;
}

async function press(view: EditorView, ...keys: string[]): Promise<void> {
  for (const key of keys) Vim.handleKey(cmOf(view), key, "user");
  await settle();
}

const KEY_CODES: Record<string, number> = { Tab: 9, Escape: 27 };

function keydown(
  view: EditorView,
  init: KeyboardEventInit & { key: string },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const keyCode = KEY_CODES[init.key] ?? init.key.toUpperCase().charCodeAt(0);
  Object.defineProperty(event, "keyCode", { value: keyCode });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const modeOf = (view: EditorView) => vimStatusOf(view.state)?.mode;
const docOf = (view: EditorView) => view.state.doc.toString();

beforeAll(() => {
  const empty = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = empty;
});

beforeEach(() => {
  Vim.resetVimGlobalState_();
});

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe("vimExtension initial mode", () => {
  it("starts in NORMAL when asked to", async () => {
    const { view } = await setup();

    expect(modeOf(view)).toBe("normal");
    expect(cmOf(view).state.vim?.insertMode).toBe(false);
  });

  it("starts in INSERT, reporting it from the very first state", async () => {
    const { view } = create({ initialMode: "insert" });

    expect(modeOf(view)).toBe("insert");
    await settle();
    expect(cmOf(view).state.vim?.insertMode).toBe(true);
    expect(modeOf(view)).toBe("insert");
  });
});

describe("vimExtension status publishing", () => {
  it.each([
    [["i"], "insert"],
    [["i", "<Esc>"], "normal"],
    [["v"], "visual"],
    [["V"], "visual-line"],
    [["<C-v>"], "visual-block"],
    [["R"], "replace"],
  ])("publishes the mode after %j", async (keys, mode) => {
    const { view } = await setup();

    await press(view, ...keys);

    expect(modeOf(view)).toBe(mode);
  });

  it("publishes pending keys as typed", async () => {
    const { view } = await setup();

    keydown(view, { key: "2" });
    keydown(view, { key: "d" });
    await settle();

    expect(vimStatusOf(view.state)?.pendingKeys).toBe("2d");

    keydown(view, { key: "Escape" });
    await settle();
    expect(vimStatusOf(view.state)?.pendingKeys).toBe("");
  });

  it("publishes the register while a macro records", async () => {
    const { view } = await setup();

    await press(view, "q", "q");
    expect(vimStatusOf(view.state)?.recording).toBe("q");

    await press(view, "q");
    expect(vimStatusOf(view.state)?.recording).toBeNull();
  });

  it("calls onStatus with every new status", async () => {
    const { view, statuses } = await setup();

    await press(view, "i");

    expect(statuses.at(-1)).toBe(vimStatusOf(view.state));
    expect(statuses.at(-1)?.mode).toBe("insert");
  });
});

describe("vimExtension editing", () => {
  it("edits with x and dd, and undoes and redoes through history", async () => {
    const { view } = await setup();

    await press(view, "x");
    expect(docOf(view)).toBe("irst line\nsecond line\nthird line");

    await press(view, "u");
    expect(docOf(view)).toBe(DOC);

    await press(view, "<C-r>");
    expect(docOf(view)).toBe("irst line\nsecond line\nthird line");

    await press(view, "u", "2", "G", "d", "d");
    expect(docOf(view)).toBe("first line\nthird line");

    await press(view, "u");
    expect(docOf(view)).toBe(DOC);
  });

  it("keeps the document unchanged while read-only, but moves and yanks", async () => {
    const { view } = await setup({}, EditorState.readOnly.of(true));

    await press(view, "x");
    expect(docOf(view)).toBe(DOC);

    await press(view, "j");
    expect(vimStatusOf(view.state)?.line).toBeGreaterThan(1);

    await press(view, "2", "G", "y", "y");
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe(
      "second line\n",
    );
    expect(docOf(view)).toBe(DOC);
  });

  it("drops DOM text input outside INSERT but lets it through in INSERT", async () => {
    const { view } = await setup();
    const typeText = () =>
      view.state
        .facet(EditorView.inputHandler)
        .some((handler) =>
          handler(view, 0, 0, "z", () =>
            view.state.update({ changes: { from: 0, insert: "z" } }),
          ),
        );

    expect(typeText()).toBe(true);
    await press(view, "v");
    expect(typeText()).toBe(true);
    await press(view, "<Esc>", "i");
    expect(typeText()).toBe(false);
  });
});

describe("vimExtension key policy", () => {
  it("indents with Tab in INSERT and consumes the event", async () => {
    const { view } = await setup({ initialMode: "insert" });

    const event = keydown(view, { key: "Tab" });

    expect(event.defaultPrevented).toBe(true);
    expect(docOf(view)).not.toBe(DOC);
  });

  it.each([[[] as string[]], [["v"]], [["V"]], [["R"]]])(
    "leaves Tab and Shift+Tab to the browser after %j",
    async (keys) => {
      const { view } = await setup();
      await press(view, ...keys);

      const tab = keydown(view, { key: "Tab" });
      const shiftTab = keydown(view, { key: "Tab", shiftKey: true });

      expect(tab.defaultPrevented).toBe(false);
      expect(shiftTab.defaultPrevented).toBe(false);
      expect(docOf(view)).toBe(DOC);
    },
  );

  it("lets formatting shortcuts win in INSERT", async () => {
    const { view } = await setup({ initialMode: "insert" });

    const event = keydown(view, { key: "b", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(docOf(view)).toBe(`****${DOC}`);
  });

  it("gives Ctrl keys to vim in NORMAL", async () => {
    const { view } = await setup();

    keydown(view, { key: "b", ctrlKey: true });
    keydown(view, { key: "v", ctrlKey: true });
    await settle();

    expect(docOf(view)).toBe(DOC);
    expect(modeOf(view)).toBe("visual-block");
  });

  it("falls through to the app keymaps for Ctrl keys vim leaves unbound", async () => {
    const { view } = await setup();

    const event = keydown(view, { key: "k", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(docOf(view)).not.toBe(DOC);
  });

  it("leaves Ctrl-c in INSERT to the browser", async () => {
    const { view } = await setup({ initialMode: "insert" });

    const event = keydown(view, { key: "c", ctrlKey: true });
    await settle();

    expect(event.defaultPrevented).toBe(false);
    expect(modeOf(view)).toBe("insert");
  });

  it("sends Escape and Ctrl-[ to vim", async () => {
    const { view } = await setup({ initialMode: "insert" });

    keydown(view, { key: "Escape" });
    await settle();
    expect(modeOf(view)).toBe("normal");

    await press(view, "v");
    keydown(view, { key: "[", ctrlKey: true });
    await settle();
    expect(modeOf(view)).toBe("normal");
  });
});

describe("vim bar commands", () => {
  it("resets from VISUAL to INSERT and clears transient status", async () => {
    const { view } = await setup();
    await press(view, "v", "l");
    view.dispatch({
      effects: setVimStatus.of({
        message: { text: "oops", error: true, id: 1 },
        commandLine: { kind: ":", value: "w" },
      }),
    });

    resetEditingMode(view, "insert");

    expect(cmOf(view).state.vim?.insertMode).toBe(true);
    expect(vimStatusOf(view.state)).toMatchObject({
      mode: "insert",
      pendingKeys: "",
      message: null,
      commandLine: null,
    });
  });

  it("resets to NORMAL and clears pending keys", async () => {
    const { view } = await setup();
    keydown(view, { key: "d" });
    await settle();

    resetEditingMode(view, "normal");

    expect(vimStatusOf(view.state)).toMatchObject({
      mode: "normal",
      pendingKeys: "",
    });
    await press(view, "x");
    expect(docOf(view)).toBe("irst line\nsecond line\nthird line");
  });

  it("enters INSERT and escapes like the keys, focusing the editor", async () => {
    const { view } = await setup();

    vimEnterInsert(view);
    await settle();
    expect(modeOf(view)).toBe("insert");
    expect(view.hasFocus).toBe(true);

    vimEscape(view);
    await settle();
    expect(modeOf(view)).toBe("normal");
  });
});

describe("vimExtension configuration", () => {
  it("exposes the write and quit callbacks", async () => {
    const { view, options } = await setup();

    expect(view.state.facet(vimCallbacks)).toEqual({
      onWrite: options.onWrite,
      onQuit: options.onQuit,
    });
  });

  it("keeps the running plugin and its mode when reconfigured", async () => {
    const { view, compartment, options } = await setup();
    const cm = cmOf(view);
    await press(view, "i");
    expect(view.dom.classList.contains("cm-vim-plain-caret")).toBe(false);

    view.dispatch({
      effects: compartment.reconfigure(
        vimExtension({ ...options, animatedCaret: false }),
      ),
    });
    await settle();

    expect(getCM(view)).toBe(cm);
    expect(cm.state.vim?.insertMode).toBe(true);
    expect(modeOf(view)).toBe("insert");
    expect(view.dom.classList.contains("cm-vim-plain-caret")).toBe(true);
  });

  it("never displays the vim panel", async () => {
    const { view } = await setup();

    await press(view, "q", "a");

    for (const panel of view.dom.querySelectorAll(".cm-vim-panel"))
      expect(getComputedStyle(panel).display).toBe("none");
    await press(view, "q");
  });

  it("shows relative line numbers and removes everything on removal", async () => {
    const { view, compartment } = await setup();
    expect(view.dom.querySelector(".cm-relative-line-numbers")).not.toBeNull();
    expect(view.scrollDOM.classList.contains("cm-vimMode")).toBe(true);
    expect(view.dom.querySelector(".cm-vimCursorLayer")).not.toBeNull();

    view.dispatch({ effects: compartment.reconfigure([]) });
    await settle();

    expect(view.dom.querySelector(".cm-relative-line-numbers")).toBeNull();
    expect(view.scrollDOM.classList.contains("cm-vimMode")).toBe(false);
    expect(view.dom.querySelector(".cm-vimCursorLayer")).toBeNull();
    expect(getCM(view)).toBeNull();

    const event = keydown(view, { key: "Tab" });
    expect(event.defaultPrevented).toBe(true);
  });
});
