// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installTypeToStart,
  isTypeToStartKey,
  type TypeToStartKey,
  type TypeToStartScene,
} from "./type-to-start";

let pane: HTMLElement;
let placeholder: HTMLElement;
let paneButton: HTMLElement;
let input: HTMLElement;
let treeItem: HTMLElement;
let editable: HTMLElement;
let separator: HTMLElement;
let outside: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="outside"></div>
    <section id="pane">
      <p id="placeholder">Nothing selected</p>
      <button id="pane-button">New</button>
      <input id="input" />
      <div role="treeitem" id="tree"><span id="tree-child"></span></div>
      <div contenteditable="true" id="editable"><span id="editable-child"></span></div>
      <div role="separator" id="separator"></div>
    </section>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  pane = get("pane");
  placeholder = get("placeholder");
  paneButton = get("pane-button");
  input = get("input");
  treeItem = get("tree");
  editable = get("editable");
  separator = get("separator");
  outside = get("outside");
});

afterEach(() => {
  document.body.innerHTML = "";
});

function scene(overrides: Partial<TypeToStartScene> = {}): TypeToStartScene {
  return {
    enabled: true,
    placeholderVisible: true,
    engineStopped: false,
    dialogOpen: false,
    menuOpen: false,
    body: document.body,
    notePane: pane,
    ...overrides,
  };
}

function key(overrides: Partial<TypeToStartKey> = {}): TypeToStartKey {
  return {
    key: "a",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: document.body,
    ...overrides,
  };
}

describe("isTypeToStartKey", () => {
  it.each(["a", "A", "7", "ż"])("fires for %s", (k) => {
    expect(isTypeToStartKey(key({ key: k }), scene())).toBe(true);
  });

  it.each([" ", "Enter", "Tab", "Dead", "Process", "Unidentified", "Escape"])(
    "does not fire for %j",
    (k) => {
      expect(isTypeToStartKey(key({ key: k }), scene())).toBe(false);
    },
  );

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
    ["Alt", { altKey: true }],
    ["Ctrl+Alt", { ctrlKey: true, altKey: true }],
    ["repeat", { repeat: true }],
    ["composing", { isComposing: true }],
    ["defaultPrevented", { defaultPrevented: true }],
  ])("does not fire with %s", (_name, overrides) => {
    expect(isTypeToStartKey(key(overrides), scene())).toBe(false);
  });

  it.each([
    ["setting off", { enabled: false }],
    ["placeholder hidden", { placeholderVisible: false }],
    ["engine stopped", { engineStopped: true }],
    ["dialog open", { dialogOpen: true }],
    ["menu open", { menuOpen: true }],
  ])("does not fire when %s", (_name, overrides) => {
    expect(isTypeToStartKey(key(), scene(overrides))).toBe(false);
  });

  it("fires for the body and non-interactive pane elements", () => {
    expect(isTypeToStartKey(key({ target: document.body }), scene())).toBe(true);
    expect(isTypeToStartKey(key({ target: placeholder }), scene())).toBe(true);
    expect(isTypeToStartKey(key({ target: pane }), scene())).toBe(true);
  });

  it("does not fire for interactive targets", () => {
    for (const target of [
      input,
      paneButton,
      treeItem,
      document.getElementById("tree-child"),
      editable,
      document.getElementById("editable-child"),
      separator,
    ]) {
      expect(isTypeToStartKey(key({ target }), scene())).toBe(false);
    }
  });

  it("does not fire for an element outside the pane", () => {
    expect(isTypeToStartKey(key({ target: outside }), scene())).toBe(false);
  });

  it("does not fire for a non-element target or without a pane", () => {
    expect(isTypeToStartKey(key({ target: new EventTarget() }), scene())).toBe(false);
    expect(isTypeToStartKey(key({ target: null }), scene())).toBe(false);
    expect(isTypeToStartKey(key({ target: placeholder }), scene({ notePane: null }))).toBe(false);
  });
});

function press(
  target: EventTarget,
  k: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("installTypeToStart", () => {
  function setup() {
    let starts = 0;
    const handle = installTypeToStart(window, {
      scene: () => scene(),
      start: () => {
        starts++;
      },
    });
    return { handle, starts: () => starts };
  }

  it("starts once and prevents the trigger key", () => {
    const { handle, starts } = setup();
    const event = press(document.body, "H");
    expect(starts()).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(handle.drain()).toBe("H");
    handle.dispose();
  });

  it("ignores keys that do not trigger", () => {
    const { handle, starts } = setup();
    const event = press(input, "H");
    expect(starts()).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    expect(handle.drain()).toBe("");
    handle.dispose();
  });

  it("queues keys typed after the trigger", () => {
    const { handle, starts } = setup();
    press(document.body, "H");
    const typed = ["e", "l", "l", "o", " ", "w"].map((k) => press(document.body, k));
    expect(typed.every((e) => e.defaultPrevented)).toBe(true);
    expect(starts()).toBe(1);
    expect(handle.drain()).toBe("Hello w");
    handle.dispose();
  });

  it("queues Enter as a newline and Backspace removes the last code point", () => {
    const { handle } = setup();
    press(document.body, "a");
    press(document.body, "Enter");
    press(document.body, "ż");
    press(document.body, "b");
    const backspace = press(document.body, "Backspace");
    expect(backspace.defaultPrevented).toBe(true);
    expect(handle.drain()).toBe("a\nż");
    handle.dispose();
  });

  it("stops propagation of queued keys", () => {
    const { handle } = setup();
    press(document.body, "a");
    let seen = 0;
    document.body.addEventListener("keydown", () => {
      seen++;
    });
    press(document.body, "b");
    expect(seen).toBe(0);
    handle.dispose();
  });

  it("ends the capture on drain", () => {
    const { handle, starts } = setup();
    press(document.body, "a");
    expect(handle.drain()).toBe("a");
    expect(handle.drain()).toBe("");
    const event = press(input, "b");
    expect(event.defaultPrevented).toBe(false);
    expect(starts()).toBe(1);
    handle.dispose();
  });

  it("lets modified and unrelated keys through during the capture", () => {
    const { handle } = setup();
    press(document.body, "a");
    const ctrl = press(document.body, "c", { ctrlKey: true });
    const meta = press(document.body, "v", { metaKey: true });
    const tab = press(document.body, "Tab");
    expect(ctrl.defaultPrevented).toBe(false);
    expect(meta.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
    expect(handle.drain()).toBe("a");
    handle.dispose();
  });

  it("removes listeners and ends the capture on dispose", () => {
    const { handle, starts } = setup();
    press(document.body, "a");
    handle.dispose();
    const event = press(document.body, "b");
    expect(event.defaultPrevented).toBe(false);
    expect(starts()).toBe(1);
    expect(handle.drain()).toBe("");
  });
});
