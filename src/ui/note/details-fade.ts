import { fade, type TransitionConfig } from "svelte/transition";
import { prefersReducedMotion } from "../browse/drag-motion";

export const DETAILS_FADE_MS = 140;

export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const at = (t: number, p1: number, p2: number): number => {
    const u = 1 - t;
    return 3 * p1 * t * u * u + 3 * p2 * u * t * t + t * t * t;
  };
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (low + high) / 2;
      if (at(t, x1, x2) < x) low = t;
      else high = t;
    }
    return at(t, y1, y2);
  };
}

const motionEasing = cubicBezier(0.2, 0, 0, 1);

// Svelte runs transitions through the Web Animations API, which the global
// reduced-motion CSS rule doesn't reach.
export function detailsFade(node: Element, instant: boolean): TransitionConfig {
  return fade(node, {
    duration: instant || prefersReducedMotion() ? 0 : DETAILS_FADE_MS,
    easing: motionEasing,
  });
}
