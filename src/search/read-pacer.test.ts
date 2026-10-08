import { describe, expect, it } from "vitest";
import { createTestClock } from "../sync/testing/test-clock";
import { createReadPacer } from "./read-pacer";

describe("createReadPacer", () => {
  it("allows reads immediately when under both limits", () => {
    const clock = createTestClock(1_000);
    const pacer = createReadPacer(clock);
    for (let i = 0; i < 10; i++) pacer.record();
    expect(pacer.availableAt()).toBe(1_000);
  });

  it("allows 120 reads in a minute and makes the 121st wait for the first to age out", () => {
    const clock = createTestClock(0);
    const pacer = createReadPacer(clock);
    for (let i = 0; i < 119; i++) {
      pacer.record();
      clock.advance(100);
    }
    expect(pacer.availableAt()).toBe(clock.now());

    pacer.record();
    expect(pacer.availableAt()).toBe(60_000);
  });

  it("binds on the hourly limit of 1,500 when reads are spread across minutes", () => {
    const clock = createTestClock(0);
    const pacer = createReadPacer(clock);
    for (let batch = 0; batch < 15; batch++) {
      for (let i = 0; i < 100; i++) pacer.record();
      if (batch < 14) clock.advance(200_000);
    }
    clock.advance(61_000);
    expect(pacer.availableAt()).toBe(3_600_000);
  });

  it("expires reads exactly at the window boundary", () => {
    const clock = createTestClock(0);
    const pacer = createReadPacer(clock, { perMinute: 1, perHour: 1_000 });
    pacer.record();

    clock.advance(59_999);
    expect(pacer.availableAt()).toBe(60_000);

    clock.advance(1);
    expect(pacer.availableAt()).toBe(60_000);
  });

  it("forgets reads older than an hour", () => {
    const clock = createTestClock(0);
    const pacer = createReadPacer(clock, { perMinute: 2, perHour: 2 });
    pacer.record();
    pacer.record();
    expect(pacer.availableAt()).toBe(3_600_000);

    clock.advance(3_600_500);
    expect(pacer.availableAt()).toBe(3_600_500);
    pacer.record();
    expect(pacer.availableAt()).toBe(3_600_500);
  });

  it("honours custom limits", () => {
    const clock = createTestClock(0);
    const pacer = createReadPacer(clock, { perMinute: 2, perHour: 3 });
    pacer.record();
    clock.advance(10_000);
    pacer.record();
    expect(pacer.availableAt()).toBe(60_000);
  });
});
