import { describe, expect, it } from "vitest";
import { createUpdateGate, type UpdateGate, type UpdateGateState } from "./update-gate";

function createTab(initiallyUnsaved = false) {
  const listeners = new Set<() => void>();
  const tab = {
    unsaved: initiallyUnsaved,
    flushes: 0,
    skipWaitings: 0,
    reloads: 0,
    onSkipWaiting: () => {},
    get listenerCount() {
      return listeners.size;
    },
    emit() {
      for (const listener of [...listeners]) listener();
    },
    clean() {
      tab.unsaved = false;
      tab.emit();
    },
    gate: undefined as unknown as UpdateGate,
  };
  tab.gate = createUpdateGate({
    hasUnsaved: () => tab.unsaved,
    flush: () => {
      tab.flushes += 1;
    },
    onUnsavedChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    skipWaiting: () => {
      tab.skipWaitings += 1;
      tab.onSkipWaiting();
    },
    reload: () => {
      tab.reloads += 1;
    },
  });
  return tab;
}

describe("update gate", () => {
  it("activates at once on a clean accept after flushing", () => {
    const tab = createTab();
    tab.gate.accept();
    expect(tab.flushes).toBe(1);
    expect(tab.skipWaitings).toBe(1);
    expect(tab.gate.state).toBe("activating");
    expect(tab.listenerCount).toBe(0);
  });

  it("waits for the unsaved check to clear before activating", () => {
    const tab = createTab(true);
    tab.gate.accept();
    expect(tab.flushes).toBe(1);
    expect(tab.skipWaitings).toBe(0);
    expect(tab.gate.state).toBe("waitingForSave");
    expect(tab.listenerCount).toBe(1);

    tab.emit();
    expect(tab.skipWaitings).toBe(0);
    expect(tab.gate.state).toBe("waitingForSave");

    tab.clean();
    tab.emit();
    expect(tab.skipWaitings).toBe(1);
    expect(tab.gate.state).toBe("activating");
    expect(tab.listenerCount).toBe(0);
  });

  it("ignores accept while activating, reloadPending or reloading", () => {
    const activating = createTab();
    activating.gate.accept();
    activating.gate.accept();
    expect(activating.skipWaitings).toBe(1);
    expect(activating.flushes).toBe(1);

    const pending = createTab(true);
    pending.gate.controllerChanged();
    pending.gate.accept();
    expect(pending.skipWaitings).toBe(0);
    expect(pending.gate.state).toBe("reloadPending");

    const reloading = createTab();
    reloading.gate.controllerChanged();
    reloading.gate.accept();
    expect(reloading.skipWaitings).toBe(0);
    expect(reloading.flushes).toBe(0);
  });

  it("reloads once on a clean controller change", () => {
    const tab = createTab();
    tab.gate.controllerChanged();
    tab.gate.controllerChanged();
    expect(tab.reloads).toBe(1);
    expect(tab.gate.state).toBe("reloading");
  });

  it("holds the reload while unsaved and reloads once when clean", () => {
    const tab = createTab(true);
    tab.gate.controllerChanged();
    expect(tab.gate.state).toBe("reloadPending");
    expect(tab.flushes).toBe(1);
    expect(tab.reloads).toBe(0);

    tab.emit();
    tab.gate.controllerChanged();
    expect(tab.reloads).toBe(0);

    tab.clean();
    tab.emit();
    tab.emit();
    tab.gate.controllerChanged();
    expect(tab.reloads).toBe(1);
    expect(tab.gate.state).toBe("reloading");
    expect(tab.listenerCount).toBe(0);
  });

  it("reloads on controller change while waiting for a save", () => {
    const tab = createTab(true);
    tab.gate.accept();
    tab.gate.controllerChanged();
    expect(tab.gate.state).toBe("reloadPending");
    expect(tab.listenerCount).toBe(1);
    tab.clean();
    expect(tab.reloads).toBe(1);
    expect(tab.skipWaitings).toBe(0);
  });

  it("keeps reloadWhenClean pending while dirty and reloads when clean", () => {
    const tab = createTab(true);
    tab.gate.controllerChanged();
    tab.gate.reloadWhenClean();
    expect(tab.flushes).toBe(2);
    expect(tab.reloads).toBe(0);
    expect(tab.gate.state).toBe("reloadPending");

    tab.unsaved = false;
    tab.gate.reloadWhenClean();
    expect(tab.reloads).toBe(1);
    expect(tab.gate.state).toBe("reloading");
    tab.gate.reloadWhenClean();
    expect(tab.reloads).toBe(1);
  });

  it("ignores reloadWhenClean outside reloadPending", () => {
    const tab = createTab();
    tab.gate.reloadWhenClean();
    expect(tab.reloads).toBe(0);
    expect(tab.gate.state).toBe("idle");
  });

  it("notifies subscribers on every state change but not on subscribe", () => {
    const tab = createTab(true);
    const seen: UpdateGateState[] = [];
    const unsubscribe = tab.gate.subscribe((state) => seen.push(state));
    expect(seen).toEqual([]);
    tab.gate.accept();
    tab.gate.accept();
    tab.clean();
    expect(seen).toEqual(["waitingForSave", "activating"]);
    unsubscribe();
    tab.gate.controllerChanged();
    expect(seen).toEqual(["waitingForSave", "activating"]);
  });

  it("reloads each tab once when one tab activates the update", () => {
    const a = createTab();
    const b = createTab(true);
    const onSkipWaiting = () => {
      a.gate.controllerChanged();
      b.gate.controllerChanged();
    };
    a.onSkipWaiting = onSkipWaiting;
    b.onSkipWaiting = onSkipWaiting;

    a.gate.accept();
    expect(a.skipWaitings).toBe(1);
    expect(a.reloads).toBe(1);
    expect(a.gate.state).toBe("reloading");
    expect(b.gate.state).toBe("reloadPending");
    expect(b.flushes).toBe(1);
    expect(b.reloads).toBe(0);

    b.emit();
    expect(b.reloads).toBe(0);
    b.clean();
    b.emit();
    expect(b.reloads).toBe(1);
    expect(b.skipWaitings).toBe(0);
    expect(a.reloads).toBe(1);
  });

  it("stops calling deps and unsubscribes on dispose", () => {
    const tab = createTab(true);
    tab.gate.accept();
    expect(tab.listenerCount).toBe(1);
    tab.gate.dispose();
    expect(tab.listenerCount).toBe(0);

    tab.unsaved = false;
    tab.emit();
    tab.gate.accept();
    tab.gate.controllerChanged();
    tab.gate.reloadWhenClean();
    expect(tab.skipWaitings).toBe(0);
    expect(tab.reloads).toBe(0);
    expect(tab.flushes).toBe(1);
  });
});
