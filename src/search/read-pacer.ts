import type { Clock } from "../sync/clock";
import { READS_PER_HOUR, READS_PER_MINUTE } from "./search-tuning";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface ReadPacerLimits {
  readonly perMinute: number;
  readonly perHour: number;
}

export interface ReadPacer {
  record(): void;
  availableAt(): number;
}

const DEFAULT_LIMITS: ReadPacerLimits = {
  perMinute: READS_PER_MINUTE,
  perHour: READS_PER_HOUR,
};

export function createReadPacer(
  clock: Pick<Clock, "now">,
  limits: ReadPacerLimits = DEFAULT_LIMITS,
): ReadPacer {
  const startedAt: number[] = [];

  function prune(now: number): void {
    let drop = 0;
    while (drop < startedAt.length && startedAt[drop] + HOUR_MS <= now) {
      drop++;
    }
    if (drop > 0) startedAt.splice(0, drop);
  }

  function freeAt(now: number, windowMs: number, allowed: number): number {
    const inWindow = startedAt.filter((t) => t + windowMs > now);
    if (inWindow.length < allowed) return now;
    return inWindow[inWindow.length - allowed] + windowMs;
  }

  return {
    record(): void {
      const now = clock.now();
      prune(now);
      startedAt.push(now);
    },
    availableAt(): number {
      const now = clock.now();
      prune(now);
      return Math.max(
        now,
        freeAt(now, MINUTE_MS, limits.perMinute),
        freeAt(now, HOUR_MS, limits.perHour),
      );
    },
  };
}
