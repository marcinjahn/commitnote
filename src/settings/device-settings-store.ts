import type { StorageLike } from "../session/session-store";
import {
  EMPTY_DEVICE_SETTINGS,
  isSwitchableSetting,
  type DeviceSettingsRecord,
  type SettingScope,
  type SwitchableSettingKey,
} from "./setting-scope";
import { SETTINGS_SCHEMA, settingValuesEqual, type Settings } from "./settings";

export const DEVICE_SETTINGS_KEY = "commitnote.deviceSettings";

const STORAGE_VERSION = 1;

export interface DeviceSettingsStore {
  read(): DeviceSettingsRecord;
  writeValues(values: Partial<Settings>): void;
  setScope(
    key: SwitchableSettingKey,
    scope: SettingScope,
    value?: unknown,
  ): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

type EventTarget = Pick<Window, "addEventListener" | "removeEventListener">;

function resolveStorage(
  storage: StorageLike | null | undefined,
): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveEvents(
  events: EventTarget | null | undefined,
): EventTarget | null {
  if (events !== undefined) return events;
  try {
    return globalThis.window ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStored(raw: string | null): DeviceSettingsRecord {
  if (raw === null) return EMPTY_DEVICE_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_DEVICE_SETTINGS;
  }
  if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
    return EMPTY_DEVICE_SETTINGS;
  }
  const scopes: Record<string, SettingScope> = {};
  if (isRecord(parsed.scopes)) {
    for (const [key, scope] of Object.entries(parsed.scopes)) {
      if (isSwitchableSetting(key) && (scope === "device" || scope === "synced")) {
        scopes[key] = scope;
      }
    }
  }
  const values: Record<string, unknown> = {};
  if (isRecord(parsed.values)) {
    for (const [key, value] of Object.entries(parsed.values)) {
      if (!isSwitchableSetting(key)) continue;
      const accepted = SETTINGS_SCHEMA[key].parse(value);
      if (accepted !== undefined) values[key] = accepted;
    }
  }
  return { scopes, values: values as Partial<Settings> };
}

function recordsEqual(a: DeviceSettingsRecord, b: DeviceSettingsRecord) {
  return (
    settingValuesEqual(a.scopes, b.scopes) &&
    settingValuesEqual(a.values, b.values)
  );
}

export function createDeviceSettingsStore(
  options: {
    storage?: StorageLike | null;
    events?: EventTarget | null;
  } = {},
): DeviceSettingsStore {
  const storage = resolveStorage(options.storage);
  const events = resolveEvents(options.events);
  const listeners = new Set<() => void>();

  function load(): DeviceSettingsRecord {
    if (!storage) return EMPTY_DEVICE_SETTINGS;
    try {
      return parseStored(storage.getItem(DEVICE_SETTINGS_KEY));
    } catch {
      return EMPTY_DEVICE_SETTINGS;
    }
  }

  let record = load();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function commit(next: DeviceSettingsRecord): void {
    if (recordsEqual(record, next)) return;
    record = next;
    if (storage) {
      try {
        storage.setItem(
          DEVICE_SETTINGS_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            scopes: next.scopes,
            values: next.values,
          }),
        );
      } catch {
        // The in-memory record keeps the session working when storage fails.
      }
    }
    notify();
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== DEVICE_SETTINGS_KEY && event.key !== null) return;
    const next = load();
    if (recordsEqual(record, next)) return;
    record = next;
    notify();
  }

  events?.addEventListener("storage", onStorage);

  return {
    read: () => record,

    writeValues(values) {
      const accepted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        if (!isSwitchableSetting(key)) continue;
        const parsed = SETTINGS_SCHEMA[key].parse(value);
        if (parsed !== undefined) accepted[key] = parsed;
      }
      commit({ scopes: record.scopes, values: { ...record.values, ...accepted } });
    },

    setScope(key, scope, value) {
      const values: Record<string, unknown> = { ...record.values };
      if (scope === "device") {
        const parsed = SETTINGS_SCHEMA[key].parse(value);
        if (parsed !== undefined) values[key] = parsed;
      } else {
        delete values[key];
      }
      commit({
        scopes: { ...record.scopes, [key]: scope },
        values: values as Partial<Settings>,
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      events?.removeEventListener("storage", onStorage);
      listeners.clear();
    },
  };
}
