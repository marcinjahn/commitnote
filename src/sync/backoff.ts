import type { SyncError } from "./sync-engine";
import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  RATE_LIMITED_MIN_WAIT_MS,
} from "./tuning";

export function retryDelayMs(error: SyncError, attempt: number): number {
  if (error.kind === "rateLimited") {
    return Math.max(error.retryAfterMs, RATE_LIMITED_MIN_WAIT_MS);
  }
  return Math.min(BACKOFF_INITIAL_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
}
