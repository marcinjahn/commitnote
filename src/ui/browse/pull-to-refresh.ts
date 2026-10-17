export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

export interface PullThresholds {
  slop: number;
  arm: number;
  resistance: number;
  max: number;
}

export const PULL_THRESHOLDS: PullThresholds = {
  slop: 10,
  arm: 64,
  resistance: 0.5,
  max: 96,
};

export interface PullState {
  phase: PullPhase;
  origin: number | null;
  distance: number;
}

export type PullEvent =
  | { type: "down"; y: number }
  | { type: "move"; y: number }
  | { type: "up" }
  | { type: "cancel" }
  | { type: "refreshed" };

export type PullEffect = "capture" | "refresh" | null;

export const INITIAL_PULL: PullState = {
  phase: "idle",
  origin: null,
  distance: 0,
};

function resistedDistance(dy: number, t: PullThresholds): number {
  return Math.min(t.max, Math.max(0, (dy - t.slop) * t.resistance));
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
      if (state.phase !== "idle" || state.origin !== null) return ignored;
      return { state: { ...state, origin: event.y }, effect: null };

    case "move": {
      if (state.origin === null || state.phase === "refreshing") return ignored;
      const dy = event.y - state.origin;
      if (state.phase === "idle") {
        if (dy > thresholds.slop) {
          const distance = resistedDistance(dy, thresholds);
          const phase = distance >= thresholds.arm ? "armed" : "pulling";
          return {
            state: { phase, origin: state.origin, distance },
            effect: "capture",
          };
        }
        if (dy < -thresholds.slop)
          return { state: { ...INITIAL_PULL }, effect: null };
        return ignored;
      }
      const distance = resistedDistance(dy, thresholds);
      const phase = distance >= thresholds.arm ? "armed" : "pulling";
      return { state: { phase, origin: state.origin, distance }, effect: null };
    }

    case "up":
      if (state.phase === "refreshing") return ignored;
      if (state.phase === "armed") {
        return {
          state: {
            phase: "refreshing",
            origin: null,
            distance: thresholds.arm,
          },
          effect: "refresh",
        };
      }
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
  return Math.min(1, Math.max(0, state.distance / thresholds.arm));
}
