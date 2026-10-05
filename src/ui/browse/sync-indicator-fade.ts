import { fade, type FadeParams, type TransitionConfig } from "svelte/transition";
import { prefersReducedMotion } from "./drag-motion";

// Svelte runs transitions through the Web Animations API, which the global
// reduced-motion CSS rule doesn't reach.

export function syncIndicatorFade(
  node: Element,
  params: FadeParams = {},
): TransitionConfig {
  return fade(node, prefersReducedMotion() ? { ...params, duration: 0 } : params);
}
