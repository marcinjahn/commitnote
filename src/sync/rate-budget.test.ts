import { describe, expect, it } from "vitest";
import { createRateBudget } from "./rate-budget";
import { createTestClock } from "./testing/test-clock";

const LIMITS = { perMinute: 60, perHour: 400 };

describe("createRateBudget", () => {
  it("fits immediately when well under both limits", () => {
    const clock = createTestClock(0);
    const budget = createRateBudget(clock, LIMITS);
    for (let i = 0; i < 10; i++) {
      budget.record();
    }
    expect(budget.availableAt(1)).toBe(0);
  });

  it("the 61st request in a minute waits until the oldest record leaves the minute window", () => {
    const clock = createTestClock(0);
    const budget = createRateBudget(clock, LIMITS);
    for (let i = 0; i < 60; i++) {
      budget.record();
      clock.advance(100);
    }
    expect(budget.availableAt(1)).toBe(60_000);
  });

  it("400 requests spread over an hour make the next one wait for the hour window even though the minute window is free", () => {
    const clock = createTestClock(0);
    const budget = createRateBudget(clock, LIMITS);
    for (let batch = 0; batch < 8; batch++) {
      for (let i = 0; i < 50; i++) {
        budget.record();
      }
      if (batch < 7) clock.advance(500_000);
    }
    // Last batch was recorded at 3_500_000; step past the minute window so it
    // no longer counts there, while the hour window is still fully spent.
    clock.advance(61_000);
    expect(budget.availableAt(1)).toBe(3_600_000);
  });

  it("records expire exactly at the window boundary", () => {
    const clock = createTestClock(0);
    const budget = createRateBudget(clock, { perMinute: 1, perHour: 1_000 });
    budget.record();

    clock.advance(59_999);
    expect(budget.availableAt(1)).toBe(60_000);

    clock.advance(1);
    expect(budget.availableAt(1)).toBe(60_000);
  });

  it("clamps a cost above a window's limit and waits for that window to empty", () => {
    const clock = createTestClock(0);
    const budget = createRateBudget(clock, { perMinute: 5, perHour: 1_000 });
    for (let i = 0; i < 5; i++) {
      budget.record();
    }
    expect(budget.availableAt(10)).toBe(60_000);
  });

  it("honours custom limits", () => {
    const clock = createTestClock(0);
    const budget = createRateBudget(clock, { perMinute: 2, perHour: 3 });
    budget.record();
    budget.record();
    expect(budget.availableAt(1)).toBe(60_000);
  });
});
