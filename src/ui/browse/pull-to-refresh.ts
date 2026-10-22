import { LONG_PRESS_MS } from "./touch-thresholds";

export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

export interface PullThresholds {
  slop: number;
  arm: number;
  max: number;
  rest: number;
  longPress: number;
}

export const PULL_THRESHOLDS: PullThresholds = {
  slop: 10,
  arm: 56,
  max: 128,
  rest: 48,
  longPress: LONG_PRESS_MS,
};

export interface PullState {
  phase: PullPhase;
  origin: number | null;
  startedAt: number | null;
  distance: number;
}

export type PullEvent =
  | { type: "down"; y: number; t: number; atTop: boolean }
  | { type: "move"; y: number; t: number }
  | { type: "up" }
  | { type: "cancel" }
  | { type: "refreshed" };

export type PullEffect = "engage" | "release" | "refresh" | null;

export const INITIAL_PULL: PullState = {
  phase: "idle",
  origin: null,
  startedAt: null,
  distance: 0,
};

function rubberBand(dy: number, t: PullThresholds): number {
  const travel = Math.max(0, dy - t.slop);
  return t.max * (1 - 1 / (1 + travel / t.max));
}

export function pullStep(
  state: PullState,
  event: PullEvent,
  thresholds: PullThresholds = PULL_THRESHOLDS,
): { state: PullState; effect: PullEffect } {
  const ignored = { state, effect: null } as const;
  const reset = { state: { ...INITIAL_PULL }, effect: null } as const;

  switch (event.type) {
    case "down":
      if (state.phase !== "idle" || state.origin !== null || !event.atTop)
        return ignored;
      return {
        state: { ...state, origin: event.y, startedAt: event.t },
        effect: null,
      };

    case "move": {
      if (state.origin === null || state.phase === "refreshing") return ignored;
      const dy = event.y - state.origin;
      const idle = state.phase === "idle";
      if (idle) {
        if (dy < -thresholds.slop) return reset;
        if (dy <= thresholds.slop) return ignored;
        if (
          state.startedAt !== null &&
          event.t - state.startedAt >= thresholds.longPress
        )
          return reset;
      }
      const distance = rubberBand(dy, thresholds);
      const phase = distance >= thresholds.arm ? "armed" : "pulling";
      return {
        state: { ...state, phase, distance },
        effect: idle ? "engage" : null,
      };
    }

    case "up":
      if (state.phase === "refreshing") return ignored;
      if (state.phase === "armed") {
        return {
          state: {
            phase: "refreshing",
            origin: null,
            startedAt: null,
            distance: thresholds.rest,
          },
          effect: "refresh",
        };
      }
      if (state.phase === "pulling")
        return { state: { ...INITIAL_PULL }, effect: "release" };
      return reset;

    case "cancel":
      return state.phase === "refreshing" ? ignored : reset;

    case "refreshed":
      return state.phase === "refreshing" ? reset : ignored;
  }
}

export function pullProgress(
  state: PullState,
  thresholds: PullThresholds = PULL_THRESHOLDS,
): number {
  if (state.phase === "refreshing") return 1;
  return Math.min(1, Math.max(0, state.distance / thresholds.arm));
}
