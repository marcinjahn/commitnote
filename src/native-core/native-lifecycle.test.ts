import { describe, expect, it } from "vitest";
import type { LifecycleHandlers } from "../app/lifecycle-triggers";
import { createNativeLifecycle } from "./native-lifecycle";

function recordingHandlers(calls: string[]): LifecycleHandlers {
  return {
    flush: () => calls.push("flush"),
    retryNow: () => calls.push("retryNow"),
    hasUnsaved: () => false,
    setOnline: (online) => calls.push(`setOnline(${online})`),
    setVisible: (visible) => calls.push(`setVisible(${visible})`),
    refreshTrigger: (trigger) => calls.push(`refreshTrigger(${trigger})`),
  };
}

describe("native lifecycle", () => {
  it("starts online and visible", () => {
    const lifecycle = createNativeLifecycle();
    expect(lifecycle.connectivity.isOnline()).toBe(true);
    expect(lifecycle.visibility.isVisible()).toBe(true);
  });

  it("calls the handlers in the browser's order for visibility and connectivity changes", () => {
    const lifecycle = createNativeLifecycle();
    const calls: string[] = [];
    lifecycle.install(recordingHandlers(calls));

    lifecycle.setVisible(false);
    lifecycle.setVisible(true);
    lifecycle.setOnline(false);
    lifecycle.setOnline(true);

    expect(calls).toEqual([
      "setVisible(false)",
      "flush",
      "setVisible(true)",
      "refreshTrigger(visible)",
      "setOnline(false)",
      "setOnline(true)",
      "retryNow",
      "refreshTrigger(online)",
    ]);
  });

  it("updates the port state and its subscribers before calling the handlers", () => {
    const lifecycle = createNativeLifecycle();
    const calls: string[] = [];
    lifecycle.visibility.subscribe((visible) => calls.push(`port(${visible})`));
    lifecycle.install({
      ...recordingHandlers(calls),
      setVisible: () =>
        calls.push(`handler sees ${lifecycle.visibility.isVisible()}`),
    });

    lifecycle.setVisible(false);

    expect(calls).toEqual(["port(false)", "handler sees false", "flush"]);
  });

  it("ignores a repeated value", () => {
    const lifecycle = createNativeLifecycle();
    const calls: string[] = [];
    lifecycle.install(recordingHandlers(calls));

    lifecycle.setVisible(true);
    lifecycle.setOnline(true);

    expect(calls).toEqual([]);
  });

  it("keeps tracking state after the handlers are uninstalled", () => {
    const lifecycle = createNativeLifecycle();
    const calls: string[] = [];
    lifecycle.install(recordingHandlers(calls))();

    lifecycle.setOnline(false);

    expect(calls).toEqual([]);
    expect(lifecycle.connectivity.isOnline()).toBe(false);
  });
});
