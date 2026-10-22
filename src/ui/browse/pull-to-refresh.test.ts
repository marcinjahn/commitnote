import { describe, expect, it } from "vitest";
import {
  INITIAL_PULL,
  PULL_THRESHOLDS,
  pullProgress,
  pullStep,
  type PullEffect,
  type PullEvent,
  type PullState,
  type PullThresholds,
} from "./pull-to-refresh";

const ORIGIN = 100;
const { slop, arm, max, rest, longPress } = PULL_THRESHOLDS;
const ARM_TRAVEL = 100;

function run(
  events: PullEvent[],
  thresholds?: PullThresholds,
  from: PullState = INITIAL_PULL,
): { state: PullState; effects: PullEffect[] } {
  let state = from;
  const effects: PullEffect[] = [];
  for (const event of events) {
    const result = pullStep(state, event, thresholds);
    state = result.state;
    effects.push(result.effect);
  }
  return { state, effects };
}

const down: PullEvent = { type: "down", y: ORIGIN, t: 0, atTop: true };
const downNotAtTop: PullEvent = { ...down, atTop: false };
const move = (travel: number, t = 50): PullEvent => ({
  type: "move",
  y: ORIGIN + slop + travel,
  t,
});
const moveDy = (dy: number, t = 50): PullEvent => ({
  type: "move",
  y: ORIGIN + dy,
  t,
});
const up: PullEvent = { type: "up" };
const cancel: PullEvent = { type: "cancel" };
const refreshed: PullEvent = { type: "refreshed" };

const distanceAt = (travel: number) => run([down, move(travel)]).state.distance;

function refreshing(): PullState {
  return run([down, move(ARM_TRAVEL), up]).state;
}

describe("thresholds", () => {
  it("matches the contract", () => {
    expect(PULL_THRESHOLDS).toEqual({
      slop: 10,
      arm: 56,
      max: 128,
      rest: 48,
      longPress: 400,
    });
  });
});

describe("rubber band", () => {
  it("follows max * (1 - 1 / (1 + travel / max))", () => {
    expect(distanceAt(0)).toBe(0);
    expect(distanceAt(56)).toBeCloseTo(128 * (1 - 1 / (1 + 56 / 128)), 10);
    expect(distanceAt(110)).toBeCloseTo(128 * (1 - 1 / (1 + 110 / 128)), 10);
    expect(distanceAt(500)).toBeCloseTo(128 * (1 - 1 / (1 + 500 / 128)), 10);
  });

  it("is monotonic and always below max", () => {
    let previous = -1;
    for (const travel of [0, 1, 10, 50, 100, 200, 500, 2000, 100000]) {
      const distance = distanceAt(travel);
      expect(distance).toBeGreaterThanOrEqual(previous);
      expect(distance).toBeLessThan(max);
      previous = distance;
    }
  });

  it("gives zero distance when dragging back above the origin", () => {
    const { state } = run([down, move(40), moveDy(-5)]);
    expect(state.distance).toBe(0);
    expect(state.phase).toBe("pulling");
  });
});

describe("pullStep", () => {
  it("records origin and start time on down without changing the phase", () => {
    const { state, effects } = run([{ ...down, t: 7 }]);
    expect(state).toEqual({
      phase: "idle",
      origin: ORIGIN,
      startedAt: 7,
      distance: 0,
    });
    expect(effects).toEqual([null]);
  });

  it("ignores a second down while a gesture is tracked", () => {
    const { state } = run([
      down,
      { type: "down", y: ORIGIN + 500, t: 5, atTop: true },
    ]);
    expect(state.origin).toBe(ORIGIN);
    expect(state.startedAt).toBe(0);
  });

  it("ignores moves without a down", () => {
    const { state, effects } = run([move(200)]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects).toEqual([null]);
  });

  it("treats a tap within the slop as a no-op", () => {
    const { state, effects } = run([
      down,
      moveDy(slop),
      moveDy(-slop),
      up,
    ]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects.every((effect) => effect === null)).toBe(true);
  });

  it("engages once, on the first move beyond the slop", () => {
    const { state, effects } = run([
      down,
      moveDy(slop),
      move(1),
      move(20),
      move(40),
    ]);
    expect(effects).toEqual([null, null, "engage", null, null]);
    expect(state.phase).toBe("pulling");
  });

  it("fires engage once even when the pull disarms and re-arms", () => {
    const { effects } = run([
      down,
      move(ARM_TRAVEL + 20),
      move(10),
      move(ARM_TRAVEL + 20),
    ]);
    expect(effects.filter((effect) => effect === "engage")).toHaveLength(1);
  });

  it("engages straight into armed on a large first move", () => {
    const { state, effects } = run([down, move(500)]);
    expect(state.phase).toBe("armed");
    expect(effects).toEqual([null, "engage"]);
  });

  it("abandons on an upward first move beyond the slop", () => {
    const { state, effects } = run([down, moveDy(-slop - 1), move(50), up]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects).toEqual([null, null, null, null]);
  });

  it("does not abandon an engaged pull when moving upward", () => {
    const { state } = run([down, move(30), moveDy(-slop - 50)]);
    expect(state.phase).toBe("pulling");
    expect(state.distance).toBe(0);
  });

  it("starts a new gesture after an abandoned one", () => {
    const { state, effects } = run([
      down,
      moveDy(-slop - 1),
      down,
      move(1),
    ]);
    expect(state.phase).toBe("pulling");
    expect(effects[3]).toBe("engage");
  });

  describe("at-top gate", () => {
    it("never engages after a not-at-top down", () => {
      const { state, effects } = run([
        downNotAtTop,
        move(1),
        move(ARM_TRAVEL + 50),
        up,
      ]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects).toEqual([null, null, null, null]);
    });

    it("leaves the state untouched", () => {
      expect(pullStep(INITIAL_PULL, downNotAtTop)).toEqual({
        state: INITIAL_PULL,
        effect: null,
      });
    });
  });

  describe("long-press gate", () => {
    it("abandons when the first move past the slop comes at the long-press time", () => {
      const { state, effects } = run([down, move(20, longPress)]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects).toEqual([null, null]);
    });

    it("engages one millisecond before the long-press time", () => {
      const { state, effects } = run([down, move(20, longPress - 1)]);
      expect(state.phase).toBe("pulling");
      expect(effects).toEqual([null, "engage"]);
    });

    it("measures from the down time", () => {
      const late = { ...down, t: 1000 };
      expect(run([late, move(20, 1000 + longPress - 1)]).state.phase).toBe(
        "pulling",
      );
      expect(run([late, move(20, 1000 + longPress)]).state).toEqual(
        INITIAL_PULL,
      );
    });

    it("does not affect an engaged pull", () => {
      const { state } = run([down, move(20, 100), move(30, longPress * 5)]);
      expect(state.phase).toBe("pulling");
    });

    it("does not abandon on slow moves within the slop", () => {
      const { state } = run([down, moveDy(slop, longPress * 2)]);
      expect(state.origin).toBe(ORIGIN);
    });
  });

  describe("arming", () => {
    it("arms at about 100 px of travel past the slop, not before", () => {
      expect(distanceAt(ARM_TRAVEL - 1)).toBeLessThan(arm);
      expect(distanceAt(ARM_TRAVEL)).toBeGreaterThanOrEqual(arm);
      expect(run([down, move(ARM_TRAVEL - 1)]).state.phase).toBe("pulling");
      expect(run([down, move(ARM_TRAVEL)]).state.phase).toBe("armed");
    });

    it("does not arm at 50 px of travel", () => {
      expect(run([down, move(50)]).state.phase).toBe("pulling");
    });

    it("disarms by dragging back", () => {
      const { state, effects } = run([
        down,
        move(ARM_TRAVEL + 50),
        move(ARM_TRAVEL - 50),
      ]);
      expect(state.phase).toBe("pulling");
      expect(effects).toEqual([null, "engage", null]);
    });

    it("re-arms after disarming", () => {
      const { state } = run([
        down,
        move(ARM_TRAVEL + 50),
        move(ARM_TRAVEL - 50),
        move(ARM_TRAVEL + 50),
      ]);
      expect(state.phase).toBe("armed");
    });
  });

  describe("release", () => {
    it("resets with release while pulling", () => {
      const { state, effects } = run([down, move(30), up]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects).toEqual([null, "engage", "release"]);
    });

    it("rests at the rest offset and refreshes once while armed", () => {
      const { state, effects } = run([down, move(ARM_TRAVEL + 100), up]);
      expect(state).toEqual({
        phase: "refreshing",
        origin: null,
        startedAt: null,
        distance: rest,
      });
      expect(effects).toEqual([null, "engage", "refresh"]);
    });

    it("resets without effect while idle", () => {
      const { state, effects } = run([down, up]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects).toEqual([null, null]);
    });
  });

  describe("while refreshing", () => {
    it("ignores down, move and up", () => {
      const start = refreshing();
      const { state, effects } = run(
        [down, move(500), up, up],
        undefined,
        start,
      );
      expect(state).toEqual(start);
      expect(effects).toEqual([null, null, null, null]);
    });

    it("ignores cancel", () => {
      const start = refreshing();
      expect(pullStep(start, cancel)).toEqual({ state: start, effect: null });
    });

    it("returns to idle on refreshed", () => {
      expect(pullStep(refreshing(), refreshed)).toEqual({
        state: INITIAL_PULL,
        effect: null,
      });
    });

    it("accepts a new gesture after refreshed", () => {
      const { state, effects } = run(
        [refreshed, down, move(1)],
        undefined,
        refreshing(),
      );
      expect(state.phase).toBe("pulling");
      expect(effects).toEqual([null, null, "engage"]);
    });
  });

  describe("cancel", () => {
    it("resets from a tracked idle gesture", () => {
      expect(run([down, cancel]).state).toEqual(INITIAL_PULL);
    });

    it("resets from pulling without effect", () => {
      const { state, effects } = run([down, move(30), cancel]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects[2]).toBeNull();
    });

    it("resets from armed without refreshing", () => {
      const { state, effects } = run([down, move(ARM_TRAVEL), cancel]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects).not.toContain("refresh");
    });
  });

  it("ignores refreshed outside refreshing", () => {
    const pulling = run([down, move(30)]).state;
    expect(pullStep(pulling, refreshed)).toEqual({
      state: pulling,
      effect: null,
    });
    expect(pullStep(INITIAL_PULL, refreshed)).toEqual({
      state: INITIAL_PULL,
      effect: null,
    });
  });

  it("does not mutate its input", () => {
    const before: PullState = {
      phase: "pulling",
      origin: ORIGIN,
      startedAt: 0,
      distance: 12,
    };
    const snapshot = { ...before };
    for (const event of [down, move(ARM_TRAVEL), up, cancel, refreshed]) {
      pullStep(before, event);
    }
    expect(before).toEqual(snapshot);
    const next = pullStep(INITIAL_PULL, cancel).state;
    expect(next).not.toBe(INITIAL_PULL);
    expect(INITIAL_PULL).toEqual({
      phase: "idle",
      origin: null,
      startedAt: null,
      distance: 0,
    });
  });

  it("honours injected thresholds", () => {
    const custom: PullThresholds = {
      slop: 4,
      arm: 20,
      max: 40,
      rest: 15,
      longPress: 100,
    };
    const engaged = run([down, moveDy(4), moveDy(5)], custom);
    expect(engaged.effects).toEqual([null, null, "engage"]);

    expect(run([down, moveDy(5, 100)], custom).state).toEqual(INITIAL_PULL);

    const released = run([down, moveDy(500), up], custom);
    expect(released.state).toEqual({
      phase: "refreshing",
      origin: null,
      startedAt: null,
      distance: 15,
    });
    expect(released.effects[2]).toBe("refresh");
  });
});

describe("pullProgress", () => {
  it("is the distance relative to the arm distance", () => {
    expect(
      pullProgress({
        phase: "pulling",
        origin: 0,
        startedAt: 0,
        distance: arm / 2,
      }),
    ).toBe(0.5);
  });

  it("clamps to 0..1", () => {
    const base = { origin: 0, startedAt: 0 };
    expect(pullProgress(INITIAL_PULL)).toBe(0);
    expect(pullProgress({ ...base, phase: "armed", distance: max })).toBe(1);
    expect(pullProgress({ ...base, phase: "pulling", distance: -5 })).toBe(0);
  });

  it("is 1 while refreshing", () => {
    expect(pullProgress(refreshing())).toBe(1);
  });

  it("uses injected thresholds", () => {
    const custom: PullThresholds = {
      slop: 1,
      arm: 10,
      max: 20,
      rest: 8,
      longPress: 100,
    };
    expect(
      pullProgress(
        { phase: "pulling", origin: 0, startedAt: 0, distance: 5 },
        custom,
      ),
    ).toBe(0.5);
  });
});
