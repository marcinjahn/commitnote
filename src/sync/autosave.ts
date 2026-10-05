import type { Clock } from "./clock";

export interface Autosave {
  noteEdited(): void;
  saveNow(): void;
  cancel(): void;
  dispose(): void;
}

export function createAutosave(options: {
  readonly clock: Clock;
  readonly debounceMs: number;
  readonly maxWaitMs: number;
  readonly save: () => void;
}): Autosave {
  const { clock, debounceMs, maxWaitMs, save } = options;

  let debounceHandle: unknown = undefined;
  let deadlineHandle: unknown = undefined;
  let disposed = false;

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

  function fire(): void {
    clearTimers();
    save();
  }

  return {
    noteEdited(): void {
      if (disposed) return;

      const startingNewWindow = debounceHandle === undefined;

      if (debounceHandle !== undefined) {
        clock.clearTimeout(debounceHandle);
      }
      debounceHandle = clock.setTimeout(fire, debounceMs);

      if (startingNewWindow) {
        deadlineHandle = clock.setTimeout(fire, maxWaitMs);
      }
    },
    saveNow(): void {
      if (disposed) return;
      clearTimers();
      save();
    },
    cancel(): void {
      clearTimers();
    },
    dispose(): void {
      clearTimers();
      disposed = true;
    },
  };
}
