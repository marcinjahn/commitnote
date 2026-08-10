import type { Clock } from "./clock";
import { RATE_BUDGET_PER_HOUR, RATE_BUDGET_PER_MINUTE } from "./tuning";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface RateBudgetLimits {
  readonly perMinute: number;
  readonly perHour: number;
}

export interface RateBudget {
  record(): void;
  availableAt(cost: number): number;
}

export function createRateBudget(
  clock: Clock,
  limits?: RateBudgetLimits,
): RateBudget {
  const perMinute = limits?.perMinute ?? RATE_BUDGET_PER_MINUTE;
  const perHour = limits?.perHour ?? RATE_BUDGET_PER_HOUR;

  // Timestamps of past requests, oldest first. Pruned against the hour
  // window only: once a record has left the hour window it has also left
  // the (shorter) minute window, so nothing needs it any more.
  const recordedAt: number[] = [];

  function prune(now: number): void {
    while (recordedAt.length > 0 && recordedAt[0] + HOUR_MS <= now) {
      recordedAt.shift();
    }
  }

  function cutoffFor(now: number, windowMs: number, allowed: number): number {
    const unexpired = recordedAt.filter((t) => t + windowMs > now);
    const excess = unexpired.length - allowed;
    if (excess <= 0) return now;
    return unexpired[excess - 1] + windowMs;
  }

  return {
    record(): void {
      const now = clock.now();
      prune(now);
      recordedAt.push(now);
    },
    availableAt(cost: number): number {
      const now = clock.now();
      prune(now);
      const minuteAllowed = perMinute - Math.min(cost, perMinute);
      const hourAllowed = perHour - Math.min(cost, perHour);
      const minuteCutoff = cutoffFor(now, MINUTE_MS, minuteAllowed);
      const hourCutoff = cutoffFor(now, HOUR_MS, hourAllowed);
      return Math.max(now, minuteCutoff, hourCutoff);
    },
  };
}
