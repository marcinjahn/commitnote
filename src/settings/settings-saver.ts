import type { Clock } from "../sync/clock";
import { changedSettingKeys } from "./settings";
import type { RawSettings, SettingsEdits } from "./settings";

export interface SettingsSaver {
  change(edits: SettingsEdits): void;
  readonly pending: SettingsEdits;
  readonly hasPending: boolean;
  subscribe(listener: () => void): () => void;
  flush(): void;
  dispose(): void;
}

export function createSettingsSaver(options: {
  readonly clock: Clock;
  readonly debounceMs: number;
  readonly maxWaitMs: number;
  readonly stored: () => RawSettings;
  readonly save: (edits: SettingsEdits) => void;
}): SettingsSaver {
  const { clock, debounceMs, maxWaitMs, stored, save } = options;

  let pending: SettingsEdits = {};
  let debounceHandle: unknown = undefined;
  let deadlineHandle: unknown = undefined;
  let disposed = false;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function clearTimers(): void {
    if (debounceHandle !== undefined) {
      clock.clearTimeout(debounceHandle);
      debounceHandle = undefined;
    }
    if (deadlineHandle !== undefined) {
      clock.clearTimeout(deadlineHandle);
      deadlineHandle = undefined;
    }
  }

  function emit(): void {
    clearTimers();
    const edits = pending;
    const keys = changedSettingKeys(stored(), edits);
    pending = {};
    notify();
    if (keys.length === 0) return;
    const changed: Record<string, unknown> = {};
    for (const key of keys) changed[key] = edits[key];
    save(changed);
  }

  return {
    change(edits: SettingsEdits): void {
      if (disposed || Object.keys(edits).length === 0) return;

      const startingNewWindow = debounceHandle === undefined;
      pending = { ...pending, ...edits };
      notify();

      if (debounceHandle !== undefined) clock.clearTimeout(debounceHandle);
      debounceHandle = clock.setTimeout(emit, debounceMs);
      if (startingNewWindow) {
        deadlineHandle = clock.setTimeout(emit, maxWaitMs);
      }
    },
    get pending(): SettingsEdits {
      return pending;
    },
    get hasPending(): boolean {
      return Object.keys(pending).length > 0;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush(): void {
      if (disposed) return;
      if (Object.keys(pending).length === 0) return;
      emit();
    },
    dispose(): void {
      clearTimers();
      pending = {};
      listeners.clear();
      disposed = true;
    },
  };
}
