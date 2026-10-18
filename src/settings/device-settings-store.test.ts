import { describe, expect, it, vi } from "vitest";
import type { StorageLike } from "../session/session-store";
import {
  createDeviceSettingsStore,
  DEVICE_SETTINGS_KEY,
} from "./device-settings-store";
import { EMPTY_DEVICE_SETTINGS } from "./setting-scope";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes++;
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}

class FakeEvents {
  private readonly handlers = new Set<(event: StorageEvent) => void>();

  addEventListener(type: string, handler: unknown): void {
    if (type === "storage") {
      this.handlers.add(handler as (event: StorageEvent) => void);
    }
  }

  removeEventListener(type: string, handler: unknown): void {
    if (type === "storage") {
      this.handlers.delete(handler as (event: StorageEvent) => void);
    }
  }

  get listenerCount(): number {
    return this.handlers.size;
  }

  dispatch(key: string | null): void {
    for (const handler of [...this.handlers]) {
      handler({ key } as StorageEvent);
    }
  }
}

function seed(storage: MemoryStorage, stored: unknown): void {
  storage.map.set(DEVICE_SETTINGS_KEY, JSON.stringify(stored));
}

function storedOf(storage: MemoryStorage): unknown {
  return JSON.parse(storage.map.get(DEVICE_SETTINGS_KEY) ?? "null");
}

describe("createDeviceSettingsStore", () => {
  it("reads empty settings when nothing is stored", () => {
    const store = createDeviceSettingsStore({
      storage: new MemoryStorage(),
      events: null,
    });
    expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
  });

  it("round-trips values and scopes to a new store instance", () => {
    const storage = new MemoryStorage();
    const first = createDeviceSettingsStore({ storage, events: null });
    first.setScope("vimMode", "device", true);
    first.setScope("noteFont", "synced");
    first.writeValues({ typeToStart: false });

    const second = createDeviceSettingsStore({ storage, events: null });
    expect(second.read()).toEqual({
      scopes: { vimMode: "device", noteFont: "synced" },
      values: { vimMode: true, typeToStart: false },
    });
    expect(storedOf(storage)).toEqual({
      version: 1,
      scopes: { vimMode: "device", noteFont: "synced" },
      values: { vimMode: true, typeToStart: false },
    });
  });

  it("returns a stable record until something changes", () => {
    const store = createDeviceSettingsStore({
      storage: new MemoryStorage(),
      events: null,
    });
    expect(store.read()).toBe(store.read());
    const before = store.read();
    store.writeValues({ vimMode: true });
    expect(store.read()).not.toBe(before);
    expect(store.read()).toBe(store.read());
  });

  it("ignores invalid JSON", () => {
    const storage = new MemoryStorage();
    storage.map.set(DEVICE_SETTINGS_KEY, "{not json");
    const store = createDeviceSettingsStore({ storage, events: null });
    expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
  });

  it("ignores non-object payloads", () => {
    const storage = new MemoryStorage();
    seed(storage, [1, 2]);
    expect(
      createDeviceSettingsStore({ storage, events: null }).read(),
    ).toEqual(EMPTY_DEVICE_SETTINGS);
    seed(storage, "text");
    expect(
      createDeviceSettingsStore({ storage, events: null }).read(),
    ).toEqual(EMPTY_DEVICE_SETTINGS);
  });

  it("ignores a wrong version", () => {
    const storage = new MemoryStorage();
    seed(storage, {
      version: 2,
      scopes: { vimMode: "device" },
      values: { vimMode: true },
    });
    const store = createDeviceSettingsStore({ storage, events: null });
    expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
  });

  it("drops invalid and unknown entries", () => {
    const storage = new MemoryStorage();
    seed(storage, {
      version: 1,
      scopes: {
        vimMode: "device",
        noteFont: "elsewhere",
        typeToStart: "synced",
        unknown: "device",
        newNotePlacement: "device",
      },
      values: {
        vimMode: true,
        animatedCaret: "yes",
        noteFont: "not-a-font",
        unknown: 1,
        newNotePlacement: "end",
      },
    });
    const store = createDeviceSettingsStore({ storage, events: null });
    expect(store.read()).toEqual({
      scopes: { vimMode: "device", typeToStart: "synced" },
      values: { vimMode: true },
    });
  });

  it("ignores non-switchable keys on write", () => {
    const storage = new MemoryStorage();
    const store = createDeviceSettingsStore({ storage, events: null });
    store.writeValues({ newNotePlacement: "end" });
    expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
    expect(storage.writes).toBe(0);
  });

  it("ignores invalid values on write", () => {
    const storage = new MemoryStorage();
    const store = createDeviceSettingsStore({ storage, events: null });
    store.writeValues({ vimMode: "yes" } as never);
    expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
    expect(storage.writes).toBe(0);
  });

  it("merges written values with existing ones", () => {
    const store = createDeviceSettingsStore({
      storage: new MemoryStorage(),
      events: null,
    });
    store.writeValues({ vimMode: true });
    store.writeValues({ typeToStart: false });
    expect(store.read().values).toEqual({ vimMode: true, typeToStart: false });
  });

  it("stores the value when switching to device and keeps the scope", () => {
    const store = createDeviceSettingsStore({
      storage: new MemoryStorage(),
      events: null,
    });
    store.setScope("noteFont", "device", "lora");
    expect(store.read()).toEqual({
      scopes: { noteFont: "device" },
      values: { noteFont: "lora" },
    });
  });

  it("deletes the value but keeps the explicit scope when switching to synced", () => {
    const storage = new MemoryStorage();
    const store = createDeviceSettingsStore({ storage, events: null });
    store.setScope("vimMode", "device", true);
    store.setScope("vimMode", "synced");
    expect(store.read()).toEqual({ scopes: { vimMode: "synced" }, values: {} });
    expect(storedOf(storage)).toEqual({
      version: 1,
      scopes: { vimMode: "synced" },
      values: {},
    });
  });

  it("sets an explicit synced scope on a fresh store", () => {
    const store = createDeviceSettingsStore({
      storage: new MemoryStorage(),
      events: null,
    });
    store.setScope("typeToStart", "synced");
    expect(store.read().scopes).toEqual({ typeToStart: "synced" });
  });

  it("keeps working in memory when storage throws", () => {
    const store = createDeviceSettingsStore({
      storage: new ThrowingStorage(),
      events: null,
    });
    expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(() => store.writeValues({ vimMode: true })).not.toThrow();
    expect(() => store.setScope("typeToStart", "device", false)).not.toThrow();
    expect(store.read()).toEqual({
      scopes: { typeToStart: "device" },
      values: { vimMode: true, typeToStart: false },
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps working in memory without storage", () => {
    const store = createDeviceSettingsStore({ storage: null, events: null });
    const listener = vi.fn();
    store.subscribe(listener);
    store.writeValues({ vimMode: true });
    expect(store.read().values).toEqual({ vimMode: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies once per change and not on no-ops", () => {
    const storage = new MemoryStorage();
    const store = createDeviceSettingsStore({ storage, events: null });
    const listener = vi.fn();
    store.subscribe(listener);

    store.writeValues({ vimMode: true });
    expect(listener).toHaveBeenCalledTimes(1);
    store.writeValues({ vimMode: true });
    store.writeValues({});
    store.writeValues({ newNotePlacement: "end" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.writes).toBe(1);

    store.setScope("typeToStart", "device", false);
    expect(listener).toHaveBeenCalledTimes(2);
    store.setScope("typeToStart", "device", false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createDeviceSettingsStore({
      storage: new MemoryStorage(),
      events: null,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.writeValues({ vimMode: true });
    expect(listener).not.toHaveBeenCalled();
  });

  describe("storage events", () => {
    it("re-reads and notifies when the settings key changes elsewhere", () => {
      const storage = new MemoryStorage();
      const events = new FakeEvents();
      const store = createDeviceSettingsStore({ storage, events });
      const listener = vi.fn();
      store.subscribe(listener);

      seed(storage, {
        version: 1,
        scopes: { vimMode: "device" },
        values: { vimMode: true },
      });
      events.dispatch(DEVICE_SETTINGS_KEY);

      expect(store.read()).toEqual({
        scopes: { vimMode: "device" },
        values: { vimMode: true },
      });
      expect(listener).toHaveBeenCalledTimes(1);

      events.dispatch(DEVICE_SETTINGS_KEY);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("re-reads when storage is cleared", () => {
      const storage = new MemoryStorage();
      const events = new FakeEvents();
      const store = createDeviceSettingsStore({ storage, events });
      store.writeValues({ vimMode: true });
      const listener = vi.fn();
      store.subscribe(listener);

      storage.map.clear();
      events.dispatch(null);

      expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("ignores events for other keys", () => {
      const storage = new MemoryStorage();
      const events = new FakeEvents();
      const store = createDeviceSettingsStore({ storage, events });
      const listener = vi.fn();
      store.subscribe(listener);

      seed(storage, {
        version: 1,
        scopes: {},
        values: { vimMode: true },
      });
      events.dispatch("commitnote.other");

      expect(store.read()).toEqual(EMPTY_DEVICE_SETTINGS);
      expect(listener).not.toHaveBeenCalled();
    });

    it("removes the listener and drops subscribers on dispose", () => {
      const storage = new MemoryStorage();
      const events = new FakeEvents();
      const store = createDeviceSettingsStore({ storage, events });
      const listener = vi.fn();
      store.subscribe(listener);
      expect(events.listenerCount).toBe(1);

      store.dispose();
      expect(events.listenerCount).toBe(0);

      store.writeValues({ vimMode: true });
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
