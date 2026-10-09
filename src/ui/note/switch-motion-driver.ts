import { prefersReducedMotion } from "../browse/drag-motion";

export const MOTION_EASING = "cubic-bezier(0.2, 0, 0, 1)";
export const SWITCH_ENTER_MS = 160;
export const LEAVE_FADE_MS = 90;
export const VIEW_SLIDE_MS = 180;

const running = new WeakMap<Element, Animation>();

// Opacity is read before cancelling, so an interrupted animation continues
// from where it visibly is instead of jumping.
function interrupt(element: Element): { opacity: number; wasRunning: boolean } {
  const parsed = Number.parseFloat(getComputedStyle(element).opacity);
  const opacity = Number.isNaN(parsed) ? 1 : parsed;
  const previous = running.get(element);
  if (previous === undefined) return { opacity, wasRunning: false };
  running.delete(element);
  previous.cancel();
  return { opacity, wasRunning: true };
}

function play(element: Element, keyframes: Keyframe[], duration: number): void {
  const animation = element.animate(keyframes, {
    duration,
    easing: MOTION_EASING,
    fill: "none",
  });
  running.set(element, animation);
  animation.addEventListener("finish", () => {
    if (running.get(element) === animation) running.delete(element);
  });
}

export function playSwitchEnter(
  elements: Iterable<Element>,
  options: { translate: boolean },
): void {
  if (prefersReducedMotion()) return;
  for (const element of elements) {
    const { opacity, wasRunning } = interrupt(element);
    const from = wasRunning ? opacity : 0;
    play(
      element,
      options.translate
        ? [
            { opacity: from, translate: "0 4px" },
            { opacity: 1, translate: "0 0" },
          ]
        : [{ opacity: from }, { opacity: 1 }],
      SWITCH_ENTER_MS,
    );
  }
}

export function playLeaveFade(elements: Iterable<Element>): void {
  if (prefersReducedMotion()) return;
  for (const element of elements) {
    const { opacity } = interrupt(element);
    play(element, [{ opacity }, { opacity: 0 }], LEAVE_FADE_MS);
  }
}

export function playViewSlide(
  element: Element,
  direction: "forward" | "back",
): void {
  if (prefersReducedMotion()) return;
  interrupt(element);
  const offset = direction === "forward" ? "12px 0" : "-12px 0";
  play(
    element,
    [
      { opacity: 0, translate: offset },
      { opacity: 1, translate: "0 0" },
    ],
    VIEW_SLIDE_MS,
  );
}
