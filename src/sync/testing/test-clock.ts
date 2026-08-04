import type { Clock } from "../clock";

interface ScheduledTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

export function createTestClock(
  start = 0,
): Clock & { advance(ms: number): void } {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();

  function setTimeoutImpl(callback: () => void, ms: number): unknown {
    const id = nextId++;
    timers.set(id, { id, dueAt: now + Math.max(0, ms), callback });
    return id;
  }

  function clearTimeoutImpl(handle: unknown): void {
    if (typeof handle === "number") {
      timers.delete(handle);
    }
  }

  function nextDueWithin(target: number): ScheduledTimer | undefined {
    let earliest: ScheduledTimer | undefined;
    for (const timer of timers.values()) {
      if (timer.dueAt > target) continue;
      if (
        earliest === undefined ||
        timer.dueAt < earliest.dueAt ||
        (timer.dueAt === earliest.dueAt && timer.id < earliest.id)
      ) {
        earliest = timer;
      }
    }
    return earliest;
  }

  function advance(ms: number): void {
    const target = now + ms;
    for (;;) {
      const timer = nextDueWithin(target);
      if (timer === undefined) break;
      timers.delete(timer.id);
      now = timer.dueAt;
      timer.callback();
    }
    now = target;
  }

  return {
    now: () => now,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    advance,
  };
}
