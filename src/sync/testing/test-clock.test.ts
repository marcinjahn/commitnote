import { describe, expect, it } from "vitest";
import { createTestClock } from "./test-clock";

describe("createTestClock", () => {
  it("starts at the given time and now() reflects the virtual clock", () => {
    const clock = createTestClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(50);
    expect(clock.now()).toBe(1050);
  });

  it("runs due timers in due-time order regardless of scheduling order", () => {
    const clock = createTestClock();
    const calls: string[] = [];
    clock.setTimeout(() => calls.push("c-at-30"), 30);
    clock.setTimeout(() => calls.push("a-at-10"), 10);
    clock.setTimeout(() => calls.push("b-at-20"), 20);

    clock.advance(30);

    expect(calls).toEqual(["a-at-10", "b-at-20", "c-at-30"]);
    expect(clock.now()).toBe(30);
  });

  it("breaks ties between timers due at the same time by scheduling order", () => {
    const clock = createTestClock();
    const calls: string[] = [];
    clock.setTimeout(() => calls.push("first"), 10);
    clock.setTimeout(() => calls.push("second"), 10);

    clock.advance(10);

    expect(calls).toEqual(["first", "second"]);
  });

  it("does not run timers scheduled beyond the advanced window", () => {
    const clock = createTestClock();
    const calls: string[] = [];
    clock.setTimeout(() => calls.push("in-range"), 10);
    clock.setTimeout(() => calls.push("out-of-range"), 20);

    clock.advance(15);

    expect(calls).toEqual(["in-range"]);
    expect(clock.now()).toBe(15);

    clock.advance(5);
    expect(calls).toEqual(["in-range", "out-of-range"]);
  });

  it("does not run a cancelled timer", () => {
    const clock = createTestClock();
    const calls: string[] = [];
    const handle = clock.setTimeout(() => calls.push("cancelled"), 10);
    clock.setTimeout(() => calls.push("kept"), 10);

    clock.clearTimeout(handle);
    clock.advance(10);

    expect(calls).toEqual(["kept"]);
  });

  it("runs timers scheduled during advance() when they are due within the window", () => {
    const clock = createTestClock();
    const calls: string[] = [];
    clock.setTimeout(() => {
      calls.push("outer-at-10");
      // Scheduled while the clock is already at 10; due at 15, which is
      // still within this advance(20) window.
      clock.setTimeout(() => calls.push("nested-at-15"), 5);
    }, 10);

    clock.advance(20);

    expect(calls).toEqual(["outer-at-10", "nested-at-15"]);
    expect(clock.now()).toBe(20);
  });

  it("does not run a timer nested beyond the advance window", () => {
    const clock = createTestClock();
    const calls: string[] = [];
    clock.setTimeout(() => {
      calls.push("outer-at-10");
      clock.setTimeout(() => calls.push("nested-at-25"), 15);
    }, 10);

    clock.advance(20);

    expect(calls).toEqual(["outer-at-10"]);
    expect(clock.now()).toBe(20);
  });
});
