// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Vim, getCM } from "@replit/codemirror-vim";
import {
  closeCommandLine,
  commandLineInput,
  commandLineKeyDown,
  openCommandLine,
  resetEditingMode,
  vimExtension,
  type VimExtensionOptions,
} from "./vim-extension";
import { vimStatusOf } from "./vim-status";

const DOC = "alpha beta\ngamma beta\ndelta a\nomega";

const views: EditorView[] = [];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(
  overrides: Partial<VimExtensionOptions> = {},
  doc = DOC,
): Promise<EditorView> {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: vimExtension({
        initialMode: "normal",
        animatedCaret: true,
        onWrite: async () => {},
        onQuit: () => {},
        ...overrides,
      }),
    }),
  });
  views.push(view);
  await settle();
  return view;
}

function cmOf(view: EditorView) {
  const cm = getCM(view);
  if (!cm) throw new Error("vim is not attached");
  return cm;
}

const statusOf = (view: EditorView) => {
  const status = vimStatusOf(view.state);
  if (!status) throw new Error("no vim status");
  return status;
};

const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  ArrowUp: 38,
};

function keyEvent(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", {
    value: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
  });
  return event;
}

async function runCommand(
  view: EditorView,
  kind: ":" | "/" | "?",
  value: string,
): Promise<void> {
  openCommandLine(view, kind);
  commandLineKeyDown(view, keyEvent("Enter"), value);
  await settle();
}

const cursorOf = (view: EditorView) => view.state.selection.main.head;

beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
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

describe("command line", () => {
  it("publishes an empty ':' command line when opened", async () => {
    const view = await setup();

    openCommandLine(view, ":");

    expect(statusOf(view).commandLine).toEqual({ kind: ":", value: "" });
  });

  it("prefills the visual range in VISUAL", async () => {
    const view = await setup();
    Vim.handleKey(cmOf(view), "v", "user");

    openCommandLine(view, ":");

    expect(statusOf(view).commandLine).toEqual({ kind: ":", value: "'<,'>" });
  });

  it("leaves INSERT before opening", async () => {
    const view = await setup({ initialMode: "insert" });

    openCommandLine(view, ":");

    expect(statusOf(view).commandLine).toEqual({ kind: ":", value: "" });
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("never fills or shows the plugin's panel", async () => {
    const view = await setup();

    openCommandLine(view, ":");
    await settle();

    expect(view.dom.querySelector(".cm-vim-panel")).toBeNull();
    commandLineKeyDown(view, keyEvent("Enter"), "e");
    await settle();
    expect(view.dom.querySelector(".cm-vim-panel")).toBeNull();
  });

  it("closes on Escape, clears the command line and focuses the view", async () => {
    const view = await setup();
    openCommandLine(view, ":");
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();

    const event = keyEvent("Escape");
    commandLineKeyDown(view, event, "w");

    expect(statusOf(view).commandLine).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(view.hasFocus).toBe(true);
    outside.remove();
  });

  it("closes without running the command when cancelled", async () => {
    const onWrite = vi.fn(async () => {});
    const view = await setup({ onWrite });
    openCommandLine(view, ":");

    closeCommandLine(view);
    commandLineKeyDown(view, keyEvent("Enter"), "w");

    expect(statusOf(view).commandLine).toBeNull();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("publishes typed input as the command line value", async () => {
    const view = await setup();
    openCommandLine(view, ":");

    commandLineInput(view, new Event("input"), "wq");

    expect(statusOf(view).commandLine).toEqual({ kind: ":", value: "wq" });
  });

  it("walks the command history with Up", async () => {
    const view = await setup();
    await runCommand(view, ":", "3");
    openCommandLine(view, ":");

    commandLineKeyDown(view, keyEvent("ArrowUp"), "");

    expect(statusOf(view).commandLine).toEqual({ kind: ":", value: "3" });
  });
});

describe("ex commands", () => {
  it.each(["w", "write"])(":%s calls onWrite once and closes", async (cmd) => {
    const onWrite = vi.fn(async () => {});
    const onQuit = vi.fn();
    const view = await setup({ onWrite, onQuit });

    await runCommand(view, ":", cmd);

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled();
    expect(statusOf(view).commandLine).toBeNull();
  });

  it.each(["q", "quit", "q!"])(":%s calls onQuit", async (cmd) => {
    const onWrite = vi.fn(async () => {});
    const onQuit = vi.fn();
    const view = await setup({ onWrite, onQuit });

    await runCommand(view, ":", cmd);

    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it.each(["wq", "x", "xit"])(
    ":%s writes, waits for the write, then quits",
    async (cmd) => {
      const calls: string[] = [];
      let finishWrite = () => {};
      const onWrite = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            calls.push("write started");
            finishWrite = () => {
              calls.push("write finished");
              resolve();
            };
          }),
      );
      const onQuit = vi.fn(() => calls.push("quit"));
      const view = await setup({ onWrite, onQuit });

      await runCommand(view, ":", cmd);
      expect(calls).toEqual(["write started"]);
      finishWrite();
      await settle();

      expect(calls).toEqual(["write started", "write finished", "quit"]);
    },
  );

  it("does not quit and shows an error when the write fails", async () => {
    const onQuit = vi.fn();
    const view = await setup({
      onWrite: () => Promise.reject(new Error("Nothing to save")),
      onQuit,
    });

    await runCommand(view, ":", "wq");

    expect(onQuit).not.toHaveBeenCalled();
    expect(statusOf(view).message).toMatchObject({
      text: "Nothing to save",
      error: true,
    });
  });

  it("runs the callbacks of the view that ran the command only", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const one = await setup({ onWrite: first });
    const two = await setup({ onWrite: second });

    await runCommand(two, ":", "w");

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    await runCommand(one, ":", "w");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("jumps to a line number", async () => {
    const view = await setup();

    await runCommand(view, ":", "3");

    expect(statusOf(view).line).toBe(3);
  });

  it("substitutes across the document", async () => {
    const view = await setup();

    await runCommand(view, ":", "%s/a/b/g");

    expect(view.state.doc.toString()).toBe(DOC.replaceAll("a", "b"));
  });

  it("reports unknown commands as errors", async () => {
    const view = await setup();

    await runCommand(view, ":", "e");

    const message = statusOf(view).message;
    expect(message?.text).toContain("Not an editor command");
    expect(message?.error).toBe(true);
  });

  it("does not treat informational listings as errors", async () => {
    const view = await setup();
    await runCommand(view, ":", "registers");

    expect(statusOf(view).message?.error).toBe(false);
  });
});

describe("messages", () => {
  it("survive the keypress that showed them and clear on the next one", async () => {
    const view = await setup();
    await runCommand(view, ":", "e");
    expect(statusOf(view).message).not.toBeNull();

    view.contentDOM.dispatchEvent(keyEvent("l"));
    await settle();

    expect(statusOf(view).message).toBeNull();
  });

  it("are not cleared by the key that produced them", async () => {
    const view = await setup();
    await runCommand(view, "/", "zzz");
    const shown = statusOf(view).message;
    expect(shown?.text).toContain("zzz");

    view.contentDOM.dispatchEvent(keyEvent("n"));
    await settle();

    const message = statusOf(view).message;
    expect(message?.text).toContain("zzz");
    expect(message?.id).not.toBe(shown?.id);
  });

  it("increase their id and clear on resetEditingMode", async () => {
    const view = await setup();
    await runCommand(view, ":", "e");
    const first = statusOf(view).message?.id ?? 0;
    await runCommand(view, ":", "e");
    expect(statusOf(view).message?.id).toBeGreaterThan(first);

    openCommandLine(view, ":");
    resetEditingMode(view, "normal");

    expect(statusOf(view).message).toBeNull();
    expect(statusOf(view).commandLine).toBeNull();
    commandLineKeyDown(view, keyEvent("Enter"), "e");
    expect(statusOf(view).message).toBeNull();
  });
});

describe("search", () => {
  it("moves to the match with / and repeats with n", async () => {
    const view = await setup();

    openCommandLine(view, "/");
    expect(statusOf(view).commandLine).toEqual({ kind: "/", value: "" });
    commandLineKeyDown(view, keyEvent("Enter"), "beta");
    await settle();

    expect(cursorOf(view)).toBe(DOC.indexOf("beta"));
    expect(statusOf(view).commandLine).toBeNull();
    Vim.handleKey(cmOf(view), "n", "user");
    expect(cursorOf(view)).toBe(DOC.lastIndexOf("beta"));
  });

  it("searches backward with ?", async () => {
    const view = await setup();
    Vim.handleKey(cmOf(view), "G", "user");

    await runCommand(view, "?", "beta");

    expect(cursorOf(view)).toBe(DOC.lastIndexOf("beta"));
  });
});
