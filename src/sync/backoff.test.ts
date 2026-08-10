import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./backoff";
import type { SyncError } from "./sync-engine";

describe("retryDelayMs", () => {
  it("doubles the delay on each attempt, capped at 300s", () => {
    const error: SyncError = { kind: "network" };
    expect(retryDelayMs(error, 1)).toBe(5_000);
    expect(retryDelayMs(error, 2)).toBe(10_000);
    expect(retryDelayMs(error, 3)).toBe(20_000);
    expect(retryDelayMs(error, 4)).toBe(40_000);
    expect(retryDelayMs(error, 5)).toBe(80_000);
    expect(retryDelayMs(error, 6)).toBe(160_000);
    expect(retryDelayMs(error, 7)).toBe(300_000);
    expect(retryDelayMs(error, 8)).toBe(300_000);
  });

  it("uses the server-provided wait when rate limited and it exceeds the minimum", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 120_000 };
    expect(retryDelayMs(error, 1)).toBe(120_000);
    expect(retryDelayMs(error, 5)).toBe(120_000);
  });

  it("floors the rate-limited wait at the minimum regardless of attempt", () => {
    const error: SyncError = { kind: "rateLimited", retryAfterMs: 10_000 };
    expect(retryDelayMs(error, 1)).toBe(60_000);
    expect(retryDelayMs(error, 3)).toBe(60_000);
  });
});
