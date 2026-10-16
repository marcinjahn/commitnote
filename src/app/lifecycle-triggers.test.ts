import { describe, expect, it } from "vitest";
import { installLifecycleTriggers } from "./lifecycle-triggers";

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

function createTargets() {
  return { window: new EventTarget(), document: new FakeDocument() };
}

function createHandlers() {
  const calls = {
    flush: 0,
    retryNow: 0,
    online: [] as boolean[],
    visible: [] as boolean[],
    triggers: [] as string[],
  };
  return {
    calls,
    handlers: {
      flush: () => {
        calls.flush++;
      },
      retryNow: () => {
        calls.retryNow++;
      },
      hasUnsaved: () => false,
      setOnline: (online: boolean) => {
        calls.online.push(online);
      },
      setVisible: (visible: boolean) => {
        calls.visible.push(visible);
      },
      refreshTrigger: (trigger: "visible" | "online") => {
        calls.triggers.push(trigger);
      },
    },
  };
}

describe("installLifecycleTriggers", () => {
  it("flushes when the document becomes hidden", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.document.visibilityState = "hidden";
    targets.document.dispatchEvent(new Event("visibilitychange"));

    expect(calls.flush).toBe(1);
  });

  it("does not flush when the document becomes visible", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.document.visibilityState = "visible";
    targets.document.dispatchEvent(new Event("visibilitychange"));

    expect(calls.flush).toBe(0);
  });

  it("flushes on pagehide", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.window.dispatchEvent(new Event("pagehide"));

    expect(calls.flush).toBe(1);
  });

  it("retries when the browser comes back online", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.window.dispatchEvent(new Event("online"));

    expect(calls.retryNow).toBe(1);
    expect(calls.online).toEqual([true]);
  });

  it("reports going offline without retrying", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.window.dispatchEvent(new Event("offline"));

    expect(calls.online).toEqual([false]);
    expect(calls.retryNow).toBe(0);
  });

  it("prevents unload only when there is unsaved work", () => {
    const targets = createTargets();
    let unsaved = false;
    installLifecycleTriggers(targets, {
      flush: () => {},
      retryNow: () => {},
      hasUnsaved: () => unsaved,
      setOnline: () => {},
      setVisible: () => {},
      refreshTrigger: () => {},
    });

    const clean = new Event("beforeunload", {
      cancelable: true,
    }) as unknown as BeforeUnloadEvent;
    targets.window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    unsaved = true;
    const dirty = new Event("beforeunload", {
      cancelable: true,
    }) as unknown as BeforeUnloadEvent;
    targets.window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    expect(dirty.returnValue).toBeFalsy();
  });

  it("removes all listeners once uninstalled", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    const uninstall = installLifecycleTriggers(targets, handlers);

    uninstall();

    targets.document.visibilityState = "hidden";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    targets.window.dispatchEvent(new Event("pagehide"));
    targets.window.dispatchEvent(new Event("offline"));
    targets.window.dispatchEvent(new Event("online"));
    targets.window.dispatchEvent(
      new Event("beforeunload", { cancelable: true }),
    );

    expect(calls.flush).toBe(0);
    expect(calls.retryNow).toBe(0);
    expect(calls.online).toEqual([]);
  });

  it("tracks visibility and triggers a refresh when the document becomes visible", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.document.visibilityState = "hidden";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    expect(calls.visible).toEqual([false]);
    expect(calls.triggers).toEqual([]);

    targets.document.visibilityState = "visible";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    expect(calls.visible).toEqual([false, true]);
    expect(calls.triggers).toEqual(["visible"]);
  });

  it("triggers a refresh on window focus only while visible", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.window.dispatchEvent(new Event("focus"));
    expect(calls.triggers).toEqual(["visible"]);

    targets.document.visibilityState = "hidden";
    targets.window.dispatchEvent(new Event("focus"));
    expect(calls.triggers).toEqual(["visible"]);
  });

  it("triggers an online refresh when the browser comes back online", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    installLifecycleTriggers(targets, handlers);

    targets.window.dispatchEvent(new Event("online"));

    expect(calls.triggers).toEqual(["online"]);
  });

  it("stops listening for focus after uninstall", () => {
    const targets = createTargets();
    const { calls, handlers } = createHandlers();
    const uninstall = installLifecycleTriggers(targets, handlers);

    uninstall();
    targets.window.dispatchEvent(new Event("focus"));

    expect(calls.triggers).toEqual([]);
  });
});
