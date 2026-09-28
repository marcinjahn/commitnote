import { describe, expect, it } from "vitest";
import { installRefreshTriggers } from "./refresh-triggers";

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

function createTargets() {
  return { window: new EventTarget(), document: new FakeDocument() };
}

describe("installRefreshTriggers", () => {
  it("calls refresh when the window gains focus", () => {
    const targets = createTargets();
    let calls = 0;
    installRefreshTriggers(targets, () => {
      calls++;
    });

    targets.window.dispatchEvent(new Event("focus"));

    expect(calls).toBe(1);
  });

  it("calls refresh on visibilitychange only when the document is visible", () => {
    const targets = createTargets();
    let calls = 0;
    installRefreshTriggers(targets, () => {
      calls++;
    });

    targets.document.visibilityState = "hidden";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toBe(0);

    targets.document.visibilityState = "visible";
    targets.document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toBe(1);
  });

  it("stops calling refresh after uninstalling", () => {
    const targets = createTargets();
    let calls = 0;
    const uninstall = installRefreshTriggers(targets, () => {
      calls++;
    });

    uninstall();

    targets.window.dispatchEvent(new Event("focus"));
    targets.document.dispatchEvent(new Event("visibilitychange"));

    expect(calls).toBe(0);
  });
});
