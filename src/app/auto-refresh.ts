import type { ObservedRateLimit } from "../forge/forge-adapter";
import type { Clock } from "../sync/clock";
import type { SyncError } from "../sync/sync-engine";
import {
  AUTO_REFRESH_INTERVAL_MS,
  AUTO_REFRESH_MAX_BACKOFF_MS,
  AUTO_REFRESH_RATE_LIMIT_RESERVE,
  AUTO_REFRESH_THROTTLE_MS,
  RATE_LIMITED_MIN_WAIT_MS,
} from "../sync/tuning";

export type RefreshTrigger = "visible" | "online" | "interval";

export interface AutoRefreshOptions {
  readonly refresh: () => Promise<void>;
  readonly lastError: () => SyncError | null;
  readonly canRefresh: () => boolean;
  readonly observedRateLimit: () => ObservedRateLimit | null;
  readonly clock: Clock;
  readonly visible: boolean;
}

export interface AutoRefresh {
  trigger(kind: RefreshTrigger): void;
  manualRefreshed(): void;
  setVisible(visible: boolean): void;
  onRefreshed(listener: (error: SyncError | null) => void): () => void;
  dispose(): void;
}

export function createAutoRefresh(options: AutoRefreshOptions): AutoRefresh {
  const { refresh, lastError, canRefresh, observedRateLimit, clock } = options;

  let visible = options.visible;
  let timer: unknown = undefined;
  let running = false;
  // Creation follows the startup refresh, so it counts as a completed one.
  let lastCompletedAt = clock.now();
  let failures = 0;
  let backoffUntil = 0;
  let pauseUntil = 0;
  let disposed = false;
  const listeners = new Set<(error: SyncError | null) => void>();

  function clearTimer(): void {
    if (timer !== undefined) {
      clock.clearTimeout(timer);
      timer = undefined;
    }
  }

  function arm(delay: number): void {
    clearTimer();
    if (!visible || disposed) return;
    timer = clock.setTimeout(() => {
      timer = undefined;
      tick();
    }, delay);
  }

  function failureBackoff(now: number): void {
    failures += 1;
    const delay = Math.min(
      AUTO_REFRESH_INTERVAL_MS * 2 ** failures,
      AUTO_REFRESH_MAX_BACKOFF_MS,
    );
    backoffUntil = now + delay;
    arm(delay);
  }

  function tick(): void {
    if (disposed || !visible || running) return;
    const now = clock.now();
    const rateLimit = observedRateLimit();
    if (
      rateLimit !== null &&
      rateLimit.remaining <= AUTO_REFRESH_RATE_LIMIT_RESERVE &&
      rateLimit.resetAt > now
    ) {
      pauseUntil = rateLimit.resetAt;
      arm(rateLimit.resetAt - now);
      return;
    }
    if (!canRefresh()) {
      arm(AUTO_REFRESH_INTERVAL_MS);
      return;
    }
    void run();
  }

  async function run(): Promise<void> {
    running = true;
    clearTimer();
    let rejected = false;
    try {
      await refresh();
    } catch (error) {
      rejected = true;
      console.error("Automatic refresh failed", error);
    }
    running = false;
    if (disposed) return;
    const now = clock.now();
    lastCompletedAt = now;
    if (rejected) {
      failureBackoff(now);
      return;
    }
    const error = lastError();
    if (error === null) {
      failures = 0;
      backoffUntil = 0;
      pauseUntil = 0;
      arm(AUTO_REFRESH_INTERVAL_MS);
    } else if (error.kind === "rateLimited") {
      failures += 1;
      const delay = Math.max(error.retryAfterMs, RATE_LIMITED_MIN_WAIT_MS);
      pauseUntil = now + delay;
      arm(delay);
    } else {
      failureBackoff(now);
    }
    for (const listener of [...listeners]) {
      listener(error);
    }
  }

  arm(AUTO_REFRESH_INTERVAL_MS);

  return {
    trigger(kind: RefreshTrigger): void {
      if (kind === "interval") {
        tick();
        return;
      }
      if (disposed || !visible || running) return;
      if (kind === "online") {
        failures = 0;
        backoffUntil = 0;
      }
      const now = clock.now();
      const blockedUntil = Math.max(backoffUntil, pauseUntil);
      if (now < blockedUntil) {
        if (timer === undefined) arm(blockedUntil - now);
        return;
      }
      if (now - lastCompletedAt < AUTO_REFRESH_THROTTLE_MS) {
        if (timer === undefined) arm(AUTO_REFRESH_INTERVAL_MS);
        return;
      }
      tick();
    },
    manualRefreshed(): void {
      if (disposed) return;
      failures = 0;
      backoffUntil = 0;
      pauseUntil = 0;
      lastCompletedAt = clock.now();
      if (visible && !running) arm(AUTO_REFRESH_INTERVAL_MS);
    },
    setVisible(next: boolean): void {
      if (disposed) return;
      visible = next;
      if (!next) clearTimer();
    },
    onRefreshed(listener: (error: SyncError | null) => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      clearTimer();
      listeners.clear();
    },
  };
}
