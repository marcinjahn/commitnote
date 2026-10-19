import { describe, expect, it, vi } from "vitest";
import {
  forwardDesktopLaunchActions,
  parseDesktopLaunchAction,
} from "./desktop-launch-actions";

describe("parseDesktopLaunchAction", () => {
  it.each(["new-note", "search"] as const)("accepts %s", (action) => {
    expect(parseDesktopLaunchAction(action)).toBe(action);
  });

  it.each(["", "other", "New-Note", "new-note&x=1", null, undefined, 1, {}])(
    "rejects %j",
    (payload) => {
      expect(parseDesktopLaunchAction(payload)).toBeNull();
    },
  );
});

describe("forwardDesktopLaunchActions", () => {
  function setup() {
    let handler: (payload: unknown) => void = () => {};
    const unlisten = vi.fn();
    const listen = vi.fn(async (h: (payload: unknown) => void) => {
      handler = h;
      return unlisten;
    });
    const deliver = vi.fn();
    return { listen, deliver, unlisten, emit: (p: unknown) => handler(p) };
  }

  it("delivers valid actions and ignores invalid payloads", async () => {
    const s = setup();
    await forwardDesktopLaunchActions(s.listen, { deliver: s.deliver });

    s.emit("search");
    s.emit("new-note");
    s.emit("bogus");
    s.emit(42);

    expect(s.deliver.mock.calls).toEqual([["search"], ["new-note"]]);
  });

  it("returns the unsubscribe function", async () => {
    const s = setup();
    const stop = await forwardDesktopLaunchActions(s.listen, {
      deliver: s.deliver,
    });
    stop();
    expect(s.unlisten).toHaveBeenCalledOnce();
  });
});
