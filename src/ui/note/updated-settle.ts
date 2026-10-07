import type { Clock } from "../../sync/clock";

export const UPDATED_SETTLE_HOLD_MS = 1200;

export interface UpdatedSettleInput {
  noteSwitch: number;
  updated: number | null;
}

export interface UpdatedSettleOptions {
  clock: Clock;
  onSettle: (settling: boolean) => void;
}

export function createUpdatedSettle(options: UpdatedSettleOptions): {
  update(input: UpdatedSettleInput): void;
  dispose(): void;
} {
  const { clock, onSettle } = options;
  let previous: UpdatedSettleInput | null = null;
  let settling = false;
  let timer: unknown = null;
  let disposed = false;

  function cancelTimer(): void {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  }

  function setSettling(next: boolean): void {
    if (next === settling) return;
    settling = next;
    onSettle(next);
  }

  function update(input: UpdatedSettleInput): void {
    if (disposed) return;
    const last = previous;
    previous = input;
    if (last === null) return;

    if (input.noteSwitch !== last.noteSwitch) {
      cancelTimer();
      setSettling(false);
      return;
    }
    if (last.updated === null || input.updated === null) return;
    if (input.updated <= last.updated) return;

    setSettling(true);
    cancelTimer();
    timer = clock.setTimeout(() => {
      timer = null;
      setSettling(false);
    }, UPDATED_SETTLE_HOLD_MS);
  }

  function dispose(): void {
    disposed = true;
    cancelTimer();
  }

  return { update, dispose };
}
