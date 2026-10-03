import { describe, expect, it } from "vitest";
import { createTestClock } from "../sync/testing/test-clock";
import { createSettingsSaver } from "./settings-saver";
import type { RawSettings, SettingsEdits } from "./settings";

const debounceMs = 1_000;
const maxWaitMs = 5_000;

function setUp(initial: RawSettings = {}) {
  const clock = createTestClock();
  const saved: SettingsEdits[] = [];
  let stored = initial;
  const saver = createSettingsSaver({
    clock,
    debounceMs,
    maxWaitMs,
    stored: () => stored,
    save: (edits) => saved.push(edits),
  });
  return {
    clock,
    saved,
    saver,
    setStored: (value: RawSettings) => {
      stored = value;
    },
  };
}

describe("createSettingsSaver", () => {
  it("emits one save with the coalesced values after a burst of edits", () => {
    const { clock, saved, saver } = setUp();

    saver.change({ a: 1 });
    clock.advance(500);
    saver.change({ a: 2, b: "x" });
    clock.advance(999);
    expect(saved).toEqual([]);

    clock.advance(1);
    expect(saved).toEqual([{ a: 2, b: "x" }]);
  });

  it("forces a save at the max wait while edits keep arriving", () => {
    const { clock, saved, saver } = setUp();

    saver.change({ a: 0 });
    for (let i = 1; i <= 5; i++) {
      clock.advance(900);
      saver.change({ a: i });
    }
    expect(saved).toEqual([]);

    clock.advance(600);
    expect(saved).toEqual([{ a: 5 }]);

    clock.advance(debounceMs);
    expect(saved).toEqual([{ a: 5 }]);
  });

  it("emits nothing when edits return to the stored value", () => {
    const { clock, saved, saver } = setUp({ a: 1 });

    saver.change({ a: 2 });
    saver.change({ a: 1 });
    clock.advance(debounceMs);

    expect(saved).toEqual([]);
    expect(saver.hasPending).toBe(false);
  });

  it("emits only the keys that differ from the stored value", () => {
    const { clock, saved, saver } = setUp({ a: 1, b: [1, 2] });

    saver.change({ a: 1, b: [1, 2], c: true });
    clock.advance(debounceMs);

    expect(saved).toEqual([{ c: true }]);
  });

  it("flush emits immediately and cancels the timers", () => {
    const { clock, saved, saver } = setUp();

    saver.change({ a: 1 });
    saver.flush();
    expect(saved).toEqual([{ a: 1 }]);

    clock.advance(maxWaitMs * 2);
    expect(saved).toHaveLength(1);
  });

  it("flush with nothing pending emits nothing", () => {
    const { saved, saver } = setUp();

    saver.flush();

    expect(saved).toEqual([]);
  });

  it("dispose drops pending edits and cancels the timers", () => {
    const { clock, saved, saver } = setUp();

    saver.change({ a: 1 });
    saver.dispose();
    clock.advance(maxWaitMs * 2);

    expect(saved).toEqual([]);
    expect(saver.hasPending).toBe(false);
  });

  it("ignores change and flush after dispose", () => {
    const { clock, saved, saver } = setUp();

    saver.dispose();
    saver.change({ a: 1 });
    saver.flush();
    clock.advance(maxWaitMs);

    expect(saved).toEqual([]);
    expect(saver.hasPending).toBe(false);
  });

  it("ignores empty edits", () => {
    const { clock, saver } = setUp();
    let notifications = 0;
    saver.subscribe(() => notifications++);

    saver.change({});
    clock.advance(maxWaitMs);

    expect(notifications).toBe(0);
    expect(saver.hasPending).toBe(false);
  });

  it("reports pending edits and notifies subscribers on edit and on emit", () => {
    const { clock, saver } = setUp();
    const snapshots: SettingsEdits[] = [];
    saver.subscribe(() => snapshots.push(saver.pending));

    saver.change({ a: 1 });
    expect(saver.hasPending).toBe(true);
    expect(saver.pending).toEqual({ a: 1 });

    saver.change({ b: 2 });
    clock.advance(debounceMs);

    expect(snapshots).toEqual([{ a: 1 }, { a: 1, b: 2 }, {}]);
    expect(saver.hasPending).toBe(false);
  });

  it("stops notifying an unsubscribed listener", () => {
    const { saver } = setUp();
    let notifications = 0;
    const unsubscribe = saver.subscribe(() => notifications++);

    unsubscribe();
    saver.change({ a: 1 });

    expect(notifications).toBe(0);
  });
});
