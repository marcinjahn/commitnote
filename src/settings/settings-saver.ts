import { createAutosave } from "../sync/autosave";
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
  let disposed = false;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function emit(): void {
    const edits = pending;
    const keys = changedSettingKeys(stored(), edits);
    pending = {};
    notify();
    if (keys.length === 0) return;
    const changed: Record<string, unknown> = {};
    for (const key of keys) changed[key] = edits[key];
    save(changed);
  }

  const autosave = createAutosave({
    clock,
    debounceMs,
    maxWaitMs,
    save: emit,
  });

  return {
    change(edits: SettingsEdits): void {
      if (disposed || Object.keys(edits).length === 0) return;

      pending = { ...pending, ...edits };
      notify();
      autosave.noteEdited();
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
      autosave.saveNow();
    },
    dispose(): void {
      autosave.dispose();
      pending = {};
      listeners.clear();
      disposed = true;
    },
  };
}
