import { describe, expect, it } from "vitest";
import { createTestClock } from "../../sync/testing/test-clock";
import { createUpdatedSettle, UPDATED_SETTLE_HOLD_MS } from "./updated-settle";

function setup() {
  const clock = createTestClock();
  const events: boolean[] = [];
  const settle = createUpdatedSettle({ clock, onSettle: (s) => events.push(s) });
  return { clock, events, settle };
}

describe("createUpdatedSettle", () => {
  it("does not settle on the first observation", () => {
    const { events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    expect(events).toEqual([]);
  });

  it("settles when updated advances on the same note and clears after the hold", () => {
    const { clock, events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 200 });
    expect(events).toEqual([true]);
    clock.advance(UPDATED_SETTLE_HOLD_MS - 1);
    expect(events).toEqual([true]);
    clock.advance(1);
    expect(events).toEqual([true, false]);
  });

  it("ignores an unchanged value", () => {
    const { events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 100 });
    expect(events).toEqual([]);
  });

  it("ignores an older value", () => {
    const { events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 50 });
    expect(events).toEqual([]);
  });

  it("does not settle on a note switch with a newer value", () => {
    const { events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 2, updated: 500 });
    expect(events).toEqual([]);
  });

  it("clears an active settle on a note switch", () => {
    const { clock, events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 200 });
    settle.update({ noteSwitch: 2, updated: 500 });
    expect(events).toEqual([true, false]);
    clock.advance(UPDATED_SETTLE_HOLD_MS * 2);
    expect(events).toEqual([true, false]);
  });

  it("does not settle when dates arrive after none", () => {
    const { events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: null });
    settle.update({ noteSwitch: 1, updated: 100 });
    expect(events).toEqual([]);
  });

  it("keeps a running hold when dates go null", () => {
    const { clock, events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 200 });
    settle.update({ noteSwitch: 1, updated: null });
    clock.advance(UPDATED_SETTLE_HOLD_MS);
    expect(events).toEqual([true, false]);
  });

  it("restarts the hold on a second advance during the hold", () => {
    const { clock, events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 200 });
    clock.advance(UPDATED_SETTLE_HOLD_MS - 200);
    settle.update({ noteSwitch: 1, updated: 300 });
    clock.advance(UPDATED_SETTLE_HOLD_MS - 1);
    expect(events).toEqual([true]);
    clock.advance(1);
    expect(events).toEqual([true, false]);
  });

  it("stops the timer and ignores updates after dispose", () => {
    const { clock, events, settle } = setup();
    settle.update({ noteSwitch: 1, updated: 100 });
    settle.update({ noteSwitch: 1, updated: 200 });
    settle.dispose();
    clock.advance(UPDATED_SETTLE_HOLD_MS * 2);
    settle.update({ noteSwitch: 1, updated: 300 });
    expect(events).toEqual([true]);
  });
});
