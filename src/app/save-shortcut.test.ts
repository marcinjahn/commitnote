import { describe, expect, it } from "vitest";
import { installSaveShortcut, isSaveShortcut } from "./save-shortcut";

const base = { key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe("isSaveShortcut", () => {
  it.each([
    ["Ctrl+s", { key: "s", ctrlKey: true }],
    ["Ctrl+S", { key: "S", ctrlKey: true }],
    ["Meta+s", { key: "s", metaKey: true }],
    ["Ctrl+Meta+s", { key: "s", ctrlKey: true, metaKey: true }],
  ])("matches %s", (_name, keys) => {
    expect(isSaveShortcut({ ...base, ...keys })).toBe(true);
  });

  it.each([
    ["plain s", {}],
    ["Ctrl+Alt+s", { ctrlKey: true, altKey: true }],
    ["Ctrl+Shift+s", { ctrlKey: true, shiftKey: true }],
    ["Meta+Alt+s", { metaKey: true, altKey: true }],
    ["Ctrl+d", { key: "d", ctrlKey: true }],
    ["Ctrl+Enter", { key: "Enter", ctrlKey: true }],
  ])("rejects %s", (_name, keys) => {
    expect(isSaveShortcut({ ...base, ...keys })).toBe(false);
  });
});

function press(target: EventTarget, init: Partial<KeyboardEvent>): Event {
  const event = Object.assign(new Event("keydown", { cancelable: true }), base, init);
  target.dispatchEvent(event);
  return event;
}

describe("installSaveShortcut", () => {
  it("prevents the default and saves once on a match", () => {
    const target = new EventTarget();
    let saves = 0;
    installSaveShortcut(target, () => saves++);

    const event = press(target, { key: "s", ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(saves).toBe(1);
  });

  it("prevents the default but does not save again on a repeat", () => {
    const target = new EventTarget();
    let saves = 0;
    installSaveShortcut(target, () => saves++);

    const event = press(target, { key: "s", metaKey: true, repeat: true });

    expect(event.defaultPrevented).toBe(true);
    expect(saves).toBe(0);
  });

  it("leaves other keys untouched", () => {
    const target = new EventTarget();
    let saves = 0;
    installSaveShortcut(target, () => saves++);

    const event = press(target, { key: "s" });

    expect(event.defaultPrevented).toBe(false);
    expect(saves).toBe(0);
  });

  it("listens in the capture phase", () => {
    const captures: unknown[] = [];
    installSaveShortcut(
      {
        addEventListener: (_type: string, _listener: unknown, options?: unknown) => {
          captures.push(options);
        },
        removeEventListener: () => {},
      },
      () => {},
    );

    expect(captures).toEqual([true]);
  });

  it("removes the same capture listener on uninstall", () => {
    const added: unknown[][] = [];
    const removed: unknown[][] = [];
    const uninstall = installSaveShortcut(
      {
        addEventListener: (...args: unknown[]) => void added.push(args),
        removeEventListener: (...args: unknown[]) => void removed.push(args),
      } as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
      () => {},
    );

    uninstall();

    expect(removed).toEqual(added);
    expect(removed).toHaveLength(1);
  });
});
