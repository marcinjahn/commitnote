// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createTestClock } from "../sync/testing/test-clock";
import type { StorageLike } from "../session/session-store";
import { UPDATE_CHECK_INTERVAL_MS } from "./app-updates";
import {
  createAutoUpdate,
  createReloadGuard,
  IDLE_APPLY_MS,
  isEditableElement,
  LAUNCH_WINDOW_MS,
  RELOAD_GUARD_MS,
} from "./auto-update";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function createUpdates() {
  const listeners = new Set<() => void>();
  const updates = {
    updateWaiting: false,
    controllerChanged: false,
    skipWaiting: vi.fn(),
    checkForUpdate: vi.fn(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    becomeWaiting() {
      updates.updateWaiting = true;
      for (const listener of [...listeners]) listener();
    },
    changeController() {
      updates.updateWaiting = false;
      updates.controllerChanged = true;
      for (const listener of [...listeners]) listener();
    },
  };
  return updates;
}

const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(initial: Partial<{
  unsaved: boolean;
  canReload: boolean;
  overlayOpen: boolean;
  editing: boolean;
  hidden: boolean;
}> = {}) {
  const clock = createTestClock(1_000_000);
  const updates = createUpdates();
  updates.skipWaiting.mockImplementation(() => updates.changeController());
  const host = {
    unsaved: false,
    canReload: true,
    overlayOpen: false,
    editing: false,
    hidden: false,
    ...initial,
    prepared: 0,
    preparing: null as Promise<void> | null,
  };
  const storage = new MemoryStorage();
  const reload = vi.fn();
  const auto = createAutoUpdate({
    updates,
    clock,
    reloadGuard: createReloadGuard(storage, clock),
    reload,
    host: {
      hasUnsaved: () => host.unsaved,
      canReload: () => host.canReload,
      overlayOpen: () => host.overlayOpen,
      editing: () => host.editing,
      hidden: () => host.hidden,
      prepareReload: async () => {
        host.prepared += 1;
        await host.preparing;
      },
    },
  });
  return { clock, updates, host, storage, reload, auto };
}

describe("at launch", () => {
  it("applies an update found before any input and reloads once", async () => {
    const { updates, reload, clock } = setup({ canReload: false });
    clock.advance(LAUNCH_WINDOW_MS - 1);
    updates.becomeWaiting();
    await flushPromises();
    expect(updates.skipWaiting).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits once the user has interacted", async () => {
    const { updates, reload, auto } = setup();
    auto.noteInput();
    updates.becomeWaiting();
    await flushPromises();
    expect(updates.skipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("waits while a dialog is open", async () => {
    const { updates, reload } = setup({ overlayOpen: true });
    updates.becomeWaiting();
    await flushPromises();
    expect(updates.skipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("while the app is in use", () => {
  async function inUse(initial: Parameters<typeof setup>[0] = {}) {
    const context = setup(initial);
    context.auto.noteInput();
    context.updates.becomeWaiting();
    await flushPromises();
    return context;
  }

  it("applies once the page is hidden with everything saved", async () => {
    const { updates, reload, host, auto } = await inUse({ editing: true });
    expect(reload).not.toHaveBeenCalled();
    host.hidden = true;
    auto.evaluate();
    await flushPromises();
    expect(updates.skipWaiting).toHaveBeenCalledTimes(1);
    expect(host.prepared).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for unsaved changes to be saved before applying", async () => {
    const { updates, reload, host, auto } = await inUse({ unsaved: true, hidden: true });
    auto.evaluate();
    await flushPromises();
    expect(updates.skipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    host.unsaved = false;
    auto.evaluate();
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("applies after an idle period with nothing unsaved", async () => {
    const { updates, reload, clock } = await inUse();
    clock.advance(IDLE_APPLY_MS - 1);
    await flushPromises();
    expect(updates.skipWaiting).not.toHaveBeenCalled();
    clock.advance(1);
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("restarts the idle period on input", async () => {
    const { reload, clock, auto } = await inUse();
    clock.advance(IDLE_APPLY_MS - 1);
    auto.noteInput();
    clock.advance(IDLE_APPLY_MS - 1);
    await flushPromises();
    expect(reload).not.toHaveBeenCalled();
    clock.advance(1);
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not apply on idle while an editor has focus", async () => {
    const { reload, clock, host, auto } = await inUse({ editing: true });
    clock.advance(IDLE_APPLY_MS * 2);
    await flushPromises();
    expect(reload).not.toHaveBeenCalled();
    host.editing = false;
    auto.evaluate();
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never applies while the session would not survive a reload", async () => {
    const { reload, clock, host, auto, updates } = await inUse({ canReload: false });
    host.hidden = true;
    auto.evaluate();
    clock.advance(IDLE_APPLY_MS * 2);
    await flushPromises();
    expect(updates.skipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the user returns while the view is being saved", async () => {
    const { updates, reload, host, auto } = setup();
    let finishPreparing = () => {};
    host.preparing = new Promise((resolve) => (finishPreparing = resolve));
    auto.noteInput();
    host.hidden = true;
    updates.becomeWaiting();
    expect(host.prepared).toBe(1);
    host.hidden = false;
    finishPreparing();
    await flushPromises();
    expect(reload).not.toHaveBeenCalled();
    host.preparing = null;
    host.hidden = true;
    auto.evaluate();
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("an update activated by another tab", () => {
  it("reloads this tab only at its own safe moment", async () => {
    const { updates, reload, host, auto } = setup({ unsaved: true });
    auto.noteInput();
    updates.changeController();
    await flushPromises();
    expect(reload).not.toHaveBeenCalled();
    host.unsaved = false;
    host.hidden = true;
    auto.evaluate();
    await flushPromises();
    expect(updates.skipWaiting).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("reload loop guard", () => {
  it("allows one automatic reload per guard period", async () => {
    const first = setup();
    first.updates.becomeWaiting();
    await flushPromises();
    expect(first.reload).toHaveBeenCalledTimes(1);

    const clock = first.clock;
    const guard = createReloadGuard(first.storage, clock);
    expect(guard.msUntilAllowed()).toBe(RELOAD_GUARD_MS);
    clock.advance(RELOAD_GUARD_MS);
    expect(guard.msUntilAllowed()).toBe(0);
  });

  it("postpones a reload until the guard period has passed", async () => {
    const { updates, reload, storage, clock } = setup();
    storage.setItem("commitnote.updateReloadAt", String(clock.now()));
    updates.becomeWaiting();
    await flushPromises();
    expect(reload).not.toHaveBeenCalled();
    clock.advance(RELOAD_GUARD_MS);
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores unreadable or future timestamps", () => {
    const storage = new MemoryStorage();
    const clock = createTestClock(1000);
    const guard = createReloadGuard(storage, clock);
    storage.setItem("commitnote.updateReloadAt", "garbage");
    expect(guard.msUntilAllowed()).toBe(0);
    storage.setItem("commitnote.updateReloadAt", "5000");
    expect(guard.msUntilAllowed()).toBe(0);
  });
});

describe("periodic checks", () => {
  it("checks for an update every interval", () => {
    const { updates, clock, auto } = setup();
    clock.advance(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(updates.checkForUpdate).toHaveBeenCalledTimes(2);
    auto.dispose();
    clock.advance(UPDATE_CHECK_INTERVAL_MS);
    expect(updates.checkForUpdate).toHaveBeenCalledTimes(2);
  });
});

describe("isEditableElement", () => {
  it("recognises text fields and contenteditable", () => {
    const textarea = document.createElement("textarea");
    const text = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const readOnly = document.createElement("input");
    readOnly.readOnly = true;
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    expect(isEditableElement(textarea)).toBe(true);
    expect(isEditableElement(text)).toBe(true);
    expect(isEditableElement(checkbox)).toBe(false);
    expect(isEditableElement(readOnly)).toBe(false);
    expect(isEditableElement(document.createElement("button"))).toBe(false);
    expect(isEditableElement(null)).toBe(false);
    editable.remove();
  });
});
