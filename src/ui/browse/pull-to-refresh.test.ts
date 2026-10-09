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
const { slop, arm, resistance, max } = PULL_THRESHOLDS;
const ARM_DY = slop + arm / resistance;
const MAX_DY = slop + max / resistance;

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

const down: PullEvent = { type: "down", y: ORIGIN };
const move = (dy: number): PullEvent => ({ type: "move", y: ORIGIN + dy });
const up: PullEvent = { type: "up" };
const cancel: PullEvent = { type: "cancel" };
const refreshed: PullEvent = { type: "refreshed" };

function refreshing(): PullState {
  return run([down, move(ARM_DY), up]).state;
}

describe("pullStep", () => {
  it("records the origin on down without changing the phase", () => {
    const { state, effects } = run([down]);
    expect(state).toEqual({ phase: "idle", origin: ORIGIN, distance: 0 });
    expect(effects).toEqual([null]);
  });

  it("ignores a second down while a gesture is tracked", () => {
    const { state } = run([down, { type: "down", y: ORIGIN + 500 }]);
    expect(state.origin).toBe(ORIGIN);
  });

  it("ignores moves without a down", () => {
    const { state, effects } = run([move(200)]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects).toEqual([null]);
  });

  it("treats a tap within the slop as a no-op", () => {
    const { state, effects } = run([down, move(slop), move(-slop), up]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects.every((effect) => effect === null)).toBe(true);
  });

  it("captures once, on the first move beyond the slop", () => {
    const { state, effects } = run([
      down,
      move(slop),
      move(slop + 1),
      move(slop + 20),
      move(slop + 40),
    ]);
    expect(effects).toEqual([null, null, "capture", null, null]);
    expect(state.phase).toBe("pulling");
  });

  it("abandons the gesture on an upward move beyond the slop", () => {
    const { state, effects } = run([
      down,
      move(-slop - 1),
      move(slop + 50),
      up,
    ]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects).toEqual([null, null, null, null]);
  });

  it("starts a new gesture after an abandoned one", () => {
    const { state, effects } = run([
      down,
      move(-slop - 1),
      down,
      move(slop + 1),
    ]);
    expect(state.phase).toBe("pulling");
    expect(effects[3]).toBe("capture");
  });

  it("applies resistance after the slop", () => {
    const { state } = run([down, move(slop + 20)]);
    expect(state.phase).toBe("pulling");
    expect(state.distance).toBe(20 * resistance);
  });

  it("clamps the distance to max", () => {
    const { state } = run([down, move(MAX_DY + 500)]);
    expect(state.distance).toBe(max);
    expect(state.phase).toBe("armed");
  });

  it("clamps the distance to zero when moving back above the origin", () => {
    const { state } = run([down, move(slop + 20), move(0)]);
    expect(state.distance).toBe(0);
    expect(state.phase).toBe("pulling");
  });

  it("arms at exactly the arm distance", () => {
    expect(run([down, move(ARM_DY - 1)]).state.phase).toBe("pulling");
    const { state } = run([down, move(ARM_DY)]);
    expect(state.phase).toBe("armed");
    expect(state.distance).toBe(arm);
  });

  it("disarms by moving back up", () => {
    const { state, effects } = run([
      down,
      move(ARM_DY + 10),
      move(ARM_DY - 10),
    ]);
    expect(state.phase).toBe("pulling");
    expect(effects).toEqual([null, "capture", null]);
  });

  it("re-arms after disarming", () => {
    const { state } = run([
      down,
      move(ARM_DY + 10),
      move(ARM_DY - 10),
      move(ARM_DY + 10),
    ]);
    expect(state.phase).toBe("armed");
  });

  it("resets on release while pulling without refreshing", () => {
    const { state, effects } = run([down, move(slop + 20), up]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects).toEqual([null, "capture", null]);
  });

  it("resets on release while idle", () => {
    const { state, effects } = run([down, up]);
    expect(state).toEqual(INITIAL_PULL);
    expect(effects).toEqual([null, null]);
  });

  it("refreshes once on release while armed and rests at the arm distance", () => {
    const { state, effects } = run([down, move(MAX_DY), up]);
    expect(state).toEqual({ phase: "refreshing", origin: null, distance: arm });
    expect(effects.filter((effect) => effect === "refresh")).toHaveLength(1);
    expect(effects[2]).toBe("refresh");
  });

  describe("while refreshing", () => {
    it("ignores down, move and up", () => {
      const start = refreshing();
      const { state, effects } = run(
        [down, move(MAX_DY), up, up],
        undefined,
        start,
      );
      expect(state).toEqual(start);
      expect(effects).toEqual([null, null, null, null]);
    });

    it("ignores cancel", () => {
      const start = refreshing();
      const result = pullStep(start, cancel);
      expect(result).toEqual({ state: start, effect: null });
    });

    it("returns to idle on refreshed", () => {
      const result = pullStep(refreshing(), refreshed);
      expect(result).toEqual({ state: INITIAL_PULL, effect: null });
    });

    it("accepts a new gesture after refreshed", () => {
      const { state, effects } = run(
        [refreshed, down, move(slop + 1)],
        undefined,
        refreshing(),
      );
      expect(state.phase).toBe("pulling");
      expect(effects).toEqual([null, null, "capture"]);
    });
  });

  describe("cancel", () => {
    it("resets from a tracked idle gesture", () => {
      expect(run([down, cancel]).state).toEqual(INITIAL_PULL);
    });

    it("resets from pulling", () => {
      const { state, effects } = run([down, move(slop + 20), cancel]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects[2]).toBeNull();
    });

    it("resets from armed without refreshing", () => {
      const { state, effects } = run([down, move(ARM_DY), cancel]);
      expect(state).toEqual(INITIAL_PULL);
      expect(effects).not.toContain("refresh");
    });
  });

  it("ignores refreshed outside refreshing", () => {
    const pulling = run([down, move(slop + 20)]).state;
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
      distance: 12,
    };
    const snapshot = { ...before };
    for (const event of [down, move(ARM_DY), up, cancel, refreshed]) {
      pullStep(before, event);
    }
    expect(before).toEqual(snapshot);
    expect(Object.isFrozen(INITIAL_PULL)).toBe(false);
    const next = pullStep(INITIAL_PULL, cancel).state;
    expect(next).not.toBe(INITIAL_PULL);
    expect(INITIAL_PULL).toEqual({ phase: "idle", origin: null, distance: 0 });
  });

  it("honours injected thresholds", () => {
    const custom: PullThresholds = { slop: 4, arm: 20, resistance: 1, max: 30 };
    const first = run([down, move(4), move(5)], custom);
    expect(first.effects).toEqual([null, null, "capture"]);
    expect(first.state.distance).toBe(1);

    expect(run([down, move(23)], custom).state.phase).toBe("pulling");
    expect(run([down, move(24)], custom).state.phase).toBe("armed");
    expect(run([down, move(500)], custom).state.distance).toBe(30);

    const released = run([down, move(24), up], custom);
    expect(released.state).toEqual({
      phase: "refreshing",
      origin: null,
      distance: 20,
    });
    expect(released.effects[2]).toBe("refresh");
  });
});

describe("pullProgress", () => {
  it("is the distance relative to the arm distance", () => {
    expect(
      pullProgress({ phase: "pulling", origin: 0, distance: arm / 2 }),
    ).toBe(0.5);
  });

  it("clamps to 0..1", () => {
    expect(pullProgress(INITIAL_PULL)).toBe(0);
    expect(pullProgress({ phase: "armed", origin: 0, distance: max })).toBe(1);
    expect(pullProgress({ phase: "pulling", origin: 0, distance: -5 })).toBe(0);
  });

  it("uses injected thresholds", () => {
    const custom: PullThresholds = { slop: 1, arm: 10, resistance: 1, max: 20 };
    expect(
      pullProgress({ phase: "pulling", origin: 0, distance: 5 }, custom),
    ).toBe(0.5);
  });
});
