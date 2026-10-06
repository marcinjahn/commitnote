import { cubicOut } from "svelte/easing";
import { slide, type TransitionConfig } from "svelte/transition";
import { DRAG_MOTION_MS, prefersReducedMotion } from "./drag-motion";

// Svelte runs transitions through the Web Animations API, which the global
// reduced-motion CSS rule doesn't reach.

export function trashReveal(node: Element): TransitionConfig {
  const { css, ...config } = slide(node, {
    axis: "y",
    duration: prefersReducedMotion() ? 0 : DRAG_MOTION_MS,
    easing: cubicOut,
  });
  return {
    ...config,
    css: (t, u) => `${css?.(t, u) ?? ""}opacity: ${t};`,
  };
}
