import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservedRateLimit } from "../forge/forge-adapter";
import type { SyncError } from "../sync/sync-engine";
import { createTestClock } from "../sync/testing/test-clock";
import { createAutoRefresh } from "./auto-refresh";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function setup(options: { visible?: boolean } = {}) {
  const clock = createTestClock(1_000_000);
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const state = {
    calls: 0,
    error: null as SyncError | null,
    canRefresh: true,
    rateLimit: null as ObservedRateLimit | null,
  };
  const auto = createAutoRefresh({
    refresh: () =>
      new Promise<void>((resolve, reject) => {
        state.calls++;
        pending.push({ resolve, reject });
      }),
    lastError: () => state.error,
    canRefresh: () => state.canRefresh,
    observedRateLimit: () => state.rateLimit,
    clock,
    visible: options.visible ?? true,
  });
  const outcomes: (SyncError | null)[] = [];
  auto.onRefreshed((error) => outcomes.push(error));

  async function complete(error: SyncError | null = null): Promise<void> {
    state.error = error;
    const next = pending.shift();
    if (next === undefined) throw new Error("no refresh in flight");
    next.resolve();
    await flush();
  }

  async function fail(): Promise<void> {
    const next = pending.shift();
    if (next === undefined) throw new Error("no refresh in flight");
    next.reject(new Error("boom"));
    await flush();
  }

  return { clock, state, auto, outcomes, complete, fail, pending };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAutoRefresh", () => {
  it("refreshes every 60 s while visible and re-arms after each refresh", async () => {
    const { clock, state, complete } = setup();

    clock.advance(MINUTE - 1);
    expect(state.calls).toBe(0);
    clock.advance(1);
    expect(state.calls).toBe(1);
    await complete();

    clock.advance(MINUTE - 1);
    expect(state.calls).toBe(1);
    clock.advance(1);
    expect(state.calls).toBe(2);
  });

  it("does nothing while hidden, and becoming visible alone does not refresh", () => {
    const { clock, state, auto } = setup({ visible: false });

    clock.advance(5 * HOUR);
    expect(state.calls).toBe(0);

    auto.setVisible(true);
    clock.advance(30 * SECOND);
    expect(state.calls).toBe(0);
  });

  it("stops the interval when hidden", () => {
    const { clock, state, auto } = setup();

    auto.setVisible(false);
    clock.advance(5 * HOUR);
    expect(state.calls).toBe(0);
  });

  it.each(["visible", "online"] as const)(
    "%s within 15 s of creation only arms the interval",
    (kind) => {
      const { clock, state, auto } = setup();

      clock.advance(14 * SECOND);
      auto.trigger(kind);
      expect(state.calls).toBe(0);

      clock.advance(MINUTE - 14 * SECOND);
      expect(state.calls).toBe(1);
    },
  );

  it.each(["visible", "online"] as const)(
    "%s refreshes immediately once 15 s have passed since the last completion",
    async (kind) => {
      const { clock, state, auto, complete } = setup();

      clock.advance(MINUTE);
      await complete();

      clock.advance(15 * SECOND - 1);
      auto.trigger(kind);
      expect(state.calls).toBe(1);

      clock.advance(1);
      auto.trigger(kind);
      expect(state.calls).toBe(2);
    },
  );

  it("becoming visible after being hidden refreshes on the visible trigger", () => {
    const { clock, state, auto } = setup();

    auto.setVisible(false);
    clock.advance(HOUR);
    auto.setVisible(true);
    expect(state.calls).toBe(0);
    auto.trigger("visible");
    expect(state.calls).toBe(1);
  });

  it("re-arms the interval when hidden then shown within the throttle window", () => {
    const { clock, state, auto } = setup();

    auto.setVisible(false);
    clock.advance(5 * SECOND);
    auto.setVisible(true);
    auto.trigger("visible");
    expect(state.calls).toBe(0);

    clock.advance(MINUTE);
    expect(state.calls).toBe(1);
  });

  it("skips while refreshing is not allowed and refreshes at the next interval without a backlog", () => {
    const { clock, state } = setup();

    state.canRefresh = false;
    clock.advance(3 * MINUTE);
    expect(state.calls).toBe(0);

    state.canRefresh = true;
    clock.advance(MINUTE);
    expect(state.calls).toBe(1);
  });

  it("doubles the back-off after failures, caps it at 10 min and resets it on success", async () => {
    const { clock, state, complete } = setup();
    const failure: SyncError = { kind: "network" };

    clock.advance(MINUTE);
    const expectedDelays = [2, 4, 8, 10, 10].map((minutes) => minutes * MINUTE);
    for (const delay of expectedDelays) {
      const before = state.calls;
      await complete(failure);
      clock.advance(delay - 1);
      expect(state.calls).toBe(before);
      clock.advance(1);
      expect(state.calls).toBe(before + 1);
    }

    await complete(null);
    const before = state.calls;
    clock.advance(MINUTE);
    expect(state.calls).toBe(before + 1);
  });

  it("treats a rejected refresh as a failure without notifying listeners", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { clock, state, fail, outcomes } = setup();

    clock.advance(MINUTE);
    await fail();
    expect(console.error).toHaveBeenCalled();
    expect(outcomes).toEqual([]);

    clock.advance(2 * MINUTE - 1);
    expect(state.calls).toBe(1);
    clock.advance(1);
    expect(state.calls).toBe(2);
  });

  it.each([
    { retryAfterMs: 5 * SECOND, expectedWait: MINUTE },
    { retryAfterMs: 3 * MINUTE, expectedWait: 3 * MINUTE },
  ])(
    "waits $expectedWait ms after being rate limited with retryAfterMs $retryAfterMs",
    async ({ retryAfterMs, expectedWait }) => {
      const { clock, state, auto, complete } = setup();

      clock.advance(MINUTE);
      await complete({ kind: "rateLimited", retryAfterMs });

      clock.advance(expectedWait - 1);
      auto.trigger("visible");
      expect(state.calls).toBe(1);
      clock.advance(1);
      expect(state.calls).toBe(2);
    },
  );

  it("pauses until the reset time when the observed rate limit is low", () => {
    const { clock, state } = setup();
    const resetAt = clock.now() + 20 * MINUTE;
    state.rateLimit = { remaining: 50, resetAt };

    clock.advance(20 * MINUTE - 1);
    expect(state.calls).toBe(0);
    clock.advance(1);
    expect(state.calls).toBe(1);
  });

  it("ignores an observed rate limit above the reserve", () => {
    const { clock, state } = setup();
    state.rateLimit = { remaining: 51, resetAt: clock.now() + HOUR };

    clock.advance(MINUTE);
    expect(state.calls).toBe(1);
  });

  it("refreshes after an observed reset time that is already in the past", () => {
    const { clock, state } = setup();
    state.rateLimit = { remaining: 0, resetAt: clock.now() };

    clock.advance(MINUTE);
    expect(state.calls).toBe(1);
  });

  it("clears the failure back-off when going online", async () => {
    const { clock, state, auto, complete } = setup();

    clock.advance(MINUTE);
    await complete({ kind: "network" });
    clock.advance(20 * SECOND);

    auto.trigger("visible");
    expect(state.calls).toBe(1);
    auto.trigger("online");
    expect(state.calls).toBe(2);
  });

  it("does not clear a rate-limit pause when going online", async () => {
    const { clock, state, auto, complete } = setup();

    clock.advance(MINUTE);
    await complete({ kind: "rateLimited", retryAfterMs: 5 * MINUTE });
    clock.advance(MINUTE);

    auto.trigger("online");
    expect(state.calls).toBe(1);
    clock.advance(4 * MINUTE);
    expect(state.calls).toBe(2);
  });

  it("restarts the interval and clears back-off after a manual refresh", async () => {
    const { clock, state, auto, complete } = setup();

    clock.advance(MINUTE);
    await complete({ kind: "rateLimited", retryAfterMs: 10 * MINUTE });

    clock.advance(30 * SECOND);
    auto.manualRefreshed();
    clock.advance(MINUTE - 1);
    expect(state.calls).toBe(1);
    clock.advance(1);
    expect(state.calls).toBe(2);
  });

  it("ignores triggers while a refresh is running", async () => {
    const { clock, state, auto, complete } = setup();

    clock.advance(MINUTE);
    clock.advance(HOUR);
    auto.trigger("visible");
    auto.trigger("online");
    expect(state.calls).toBe(1);

    await complete();
    expect(state.calls).toBe(1);
  });

  it("notifies listeners of each outcome until they unsubscribe", async () => {
    const { clock, auto, outcomes, complete } = setup();
    const own: (SyncError | null)[] = [];
    const unsubscribe = auto.onRefreshed((error) => own.push(error));

    clock.advance(MINUTE);
    await complete();
    clock.advance(MINUTE);
    unsubscribe();
    await complete({ kind: "server" });

    expect(own).toEqual([null]);
    expect(outcomes).toEqual([null, { kind: "server" }]);
  });

  it("stops everything after dispose", async () => {
    const { clock, state, auto, outcomes, complete } = setup();

    clock.advance(MINUTE);
    auto.dispose();
    await complete();
    expect(outcomes).toEqual([]);

    clock.advance(HOUR);
    auto.trigger("visible");
    auto.trigger("online");
    auto.manualRefreshed();
    clock.advance(HOUR);
    expect(state.calls).toBe(1);
  });
});
