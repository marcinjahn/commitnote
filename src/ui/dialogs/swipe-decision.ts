export const SWIPE_ARM_SLOP_PX = 8;
export const SWIPE_CLOSE_FRACTION = 0.3;
export const SWIPE_CLOSE_VELOCITY = 0.5;
export const SWIPE_VELOCITY_WINDOW_MS = 100;

export type SwipeArming = "pending" | "armed" | "aborted";

export function swipeArming(dx: number, dy: number): SwipeArming {
  if (Math.hypot(dx, dy) < SWIPE_ARM_SLOP_PX) return "pending";
  if (Math.abs(dx) >= Math.abs(dy) || dy <= 0) return "aborted";
  return "armed";
}

interface VelocitySample {
  y: number;
  time: number;
}

export function createVelocityTracker() {
  let samples: VelocitySample[] = [];

  return {
    add(y: number, time: number): void {
      samples.push({ y, time });
      const cutoff = time - SWIPE_VELOCITY_WINDOW_MS;
      samples = samples.filter((sample) => sample.time >= cutoff);
    },
    velocity(now: number): number {
      const recent = samples.filter(
        (sample) => sample.time >= now - SWIPE_VELOCITY_WINDOW_MS,
      );
      if (recent.length < 2) return 0;
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const span = newest.time - oldest.time;
      if (span <= 0) return 0;
      return (newest.y - oldest.y) / span;
    },
    reset(): void {
      samples = [];
    },
  };
}

export type SwipeDecision = "close" | "snap-back";

export function swipeDecision(
  offset: number,
  cardHeight: number,
  velocity: number,
): SwipeDecision {
  if (offset <= 0) return "snap-back";
  const distanceMet =
    cardHeight > 0 && offset >= SWIPE_CLOSE_FRACTION * cardHeight;
  return distanceMet || velocity >= SWIPE_CLOSE_VELOCITY ? "close" : "snap-back";
}
