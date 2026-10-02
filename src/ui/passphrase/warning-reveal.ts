import { cubicOut } from "svelte/easing";
import { slide, type TransitionConfig } from "svelte/transition";
import { prefersReducedMotion } from "../browse/drag-motion";

export function warningReveal(node: Element): TransitionConfig {
  const config = slide(node, {
    duration: prefersReducedMotion() ? 0 : 200,
    easing: cubicOut,
  });
  return {
    ...config,
    css: (t, u) => `${config.css?.(t, u) ?? ""} opacity: ${t};`,
  };
}
