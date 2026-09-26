import { fade, type FadeParams, type TransitionConfig } from "svelte/transition";

// Svelte runs transitions through the Web Animations API, which the global
// reduced-motion CSS rule doesn't reach.
function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function syncIndicatorFade(
  node: Element,
  params: FadeParams = {},
): TransitionConfig {
  return fade(node, prefersReducedMotion() ? { ...params, duration: 0 } : params);
}
