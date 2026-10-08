import { flip, type AnimationConfig } from "svelte/animate";
import type { TransitionConfig } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import { prefersReducedMotion } from "../browse/drag-motion";

// Svelte runs these through the Web Animations API, which the global
// reduced-motion CSS rule doesn't reach.

const OUT_DURATION_MS = 120;
const OUT_OFFSET_PX = 4;
const REFLOW_DURATION_MS = 140;

export function toastOut(node: Element): TransitionConfig {
  const base = getComputedStyle(node).transform;
  const prefix = base === "none" ? "" : `${base} `;
  return {
    duration: prefersReducedMotion() ? 0 : OUT_DURATION_MS,
    easing: cubicOut,
    css: (t, u) =>
      `opacity: ${t}; transform: ${prefix}translateY(${u * OUT_OFFSET_PX}px)`,
  };
}

export function toastReflow(
  node: Element,
  rects: { from: DOMRect; to: DOMRect },
): AnimationConfig {
  return flip(node, rects, {
    duration: prefersReducedMotion() ? 0 : REFLOW_DURATION_MS,
    easing: cubicOut,
  });
}
