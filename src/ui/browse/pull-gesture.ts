import type { ActionReturn } from "svelte/action";
import {
  INITIAL_PULL,
  PULL_THRESHOLDS,
  pullProgress,
  pullStep,
  type PullEffect,
  type PullEvent,
  type PullPhase,
  type PullState,
} from "./pull-to-refresh";

export interface PullClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): void;
}

export interface PullGestureOptions {
  enabled: boolean;
  atTop: () => boolean;
  canStart?: (event: TouchEvent) => boolean;
  content: () => HTMLElement | null;
  indicator: () => HTMLElement | null;
  onChange: (phase: PullPhase) => void;
  onRefresh: () => Promise<unknown>;
  clock?: PullClock;
  reducedMotion?: () => boolean;
}

const SPRING_MS = 260;
const SETTLE_FALLBACK_MS = 300;
const MIN_REFRESH_MS = 500;
const CHIP_SIZE = 32;
const CHIP_REST = (PULL_THRESHOLDS.rest - CHIP_SIZE) / 2;
const SPRING = `${SPRING_MS}ms var(--motion-easing)`;

const systemClock: PullClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    globalThis.setTimeout(fn, ms);
  },
};

function systemReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type View =
  | { kind: "drag"; distance: number; progress: number }
  | { kind: "rest" }
  | { kind: "home" };

function chipOffset(distance: number): number {
  return (distance - CHIP_SIZE) / 2;
}

export function pullGesture(
  node: HTMLElement,
  initial: PullGestureOptions,
): ActionReturn<PullGestureOptions> {
  let options = initial;
  let state: PullState = INITIAL_PULL;
  let tracking = false;
  let reduced = false;
  let destroyed = false;
  let frame: number | null = null;
  let pending: View | null = null;
  let settling: (() => void) | null = null;
  const styled = new Set<HTMLElement>();

  const clock = (): PullClock => options.clock ?? systemClock;

  function feed(event: PullEvent): PullEffect {
    const previous = state.phase;
    const step = pullStep(state, event);
    state = step.state;
    if (state.phase !== previous) {
      if (!destroyed) options.onChange(state.phase);
      render(previous);
    }
    return step.effect;
  }

  function engaged(): boolean {
    return state.phase === "pulling" || state.phase === "armed";
  }

  function render(previous: PullPhase): void {
    if (engaged()) return;
    if (state.phase === "refreshing") schedule({ kind: "rest" });
    else if (previous !== "idle") schedule({ kind: "home" });
  }

  function schedule(view: View): void {
    pending = view;
    if (frame === null) frame = requestAnimationFrame(flush);
  }

  function flush(): void {
    frame = null;
    const view = pending;
    pending = null;
    if (view !== null) apply(view);
  }

  function targets(): {
    content: HTMLElement | null;
    chip: HTMLElement | null;
  } {
    return {
      content: reduced ? null : options.content(),
      chip: options.indicator(),
    };
  }

  function apply(view: View): void {
    stopSettling();
    const { content, chip } = targets();
    if (content) styled.add(content);
    if (chip) styled.add(chip);

    if (view.kind === "home" && reduced) {
      clearStyles();
      return;
    }

    const animate = view.kind !== "drag" && !reduced;
    if (content) {
      content.style.transition = animate ? `transform ${SPRING}` : "";
      if (view.kind === "drag") content.style.willChange = "transform";
    }
    if (chip) {
      chip.style.transition = animate
        ? `transform ${SPRING}, opacity ${SPRING}`
        : "";
      if (view.kind === "drag" && !reduced) chip.style.willChange = "transform";
    }

    const distance =
      view.kind === "drag"
        ? view.distance
        : view.kind === "rest"
          ? PULL_THRESHOLDS.rest
          : 0;
    const progress =
      view.kind === "drag" ? view.progress : view.kind === "rest" ? 1 : 0;
    if (content) content.style.transform = `translateY(${distance}px)`;
    if (chip) {
      chip.style.transform = `translateY(${reduced ? CHIP_REST : chipOffset(distance)}px)`;
      chip.style.setProperty("--pull-progress", String(progress));
    }

    if (view.kind === "home") settleAfterSpring([content, chip]);
  }

  function settleAfterSpring(elements: (HTMLElement | null)[]): void {
    const moving = elements.filter((el): el is HTMLElement => el !== null);
    if (moving.length === 0) {
      clearStyles();
      return;
    }
    const onEnd = (event: Event): void => {
      if (
        event.target === event.currentTarget &&
        (event as TransitionEvent).propertyName === "transform"
      ) {
        done();
      }
    };
    const done = (): void => {
      if (settling !== stop) return;
      stopSettling();
      clearStyles();
    };
    const stop = (): void => {
      for (const el of moving) el.removeEventListener("transitionend", onEnd);
    };
    settling = stop;
    for (const el of moving) el.addEventListener("transitionend", onEnd);
    clock().setTimeout(done, SETTLE_FALLBACK_MS);
  }

  function stopSettling(): void {
    settling?.();
    settling = null;
  }

  function clearStyles(): void {
    for (const el of styled) {
      el.style.transform = "";
      el.style.transition = "";
      el.style.willChange = "";
      el.style.removeProperty("--pull-progress");
    }
    styled.clear();
  }

  async function refresh(): Promise<void> {
    const started = clock().now();
    try {
      await options.onRefresh();
    } catch {
      // The refresh reports its own failure; the spinner only has to end.
    }
    const remaining = MIN_REFRESH_MS - (clock().now() - started);
    if (remaining > 0) {
      await new Promise<void>((resolve) =>
        clock().setTimeout(resolve, remaining),
      );
    }
    if (!destroyed) feed({ type: "refreshed" });
  }

  function track(): void {
    tracking = true;
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchCancel);
  }

  function untrack(): void {
    tracking = false;
    node.removeEventListener("touchmove", onTouchMove);
    node.removeEventListener("touchend", onTouchEnd);
    node.removeEventListener("touchcancel", onTouchCancel);
  }

  function cancel(): void {
    untrack();
    feed({ type: "cancel" });
  }

  function onTouchStart(event: TouchEvent): void {
    if (tracking) {
      cancel();
      if (event.touches.length > 1) return;
    }
    if (
      !options.enabled ||
      state.phase !== "idle" ||
      event.touches.length !== 1 ||
      !options.atTop() ||
      !(options.canStart?.(event) ?? true)
    ) {
      return;
    }
    reduced = (options.reducedMotion ?? systemReducedMotion)();
    track();
    feed({
      type: "down",
      y: event.touches[0].clientY,
      t: event.timeStamp,
      atTop: true,
    });
  }

  function onTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 1) {
      cancel();
      return;
    }
    feed({ type: "move", y: event.touches[0].clientY, t: event.timeStamp });
    if (engaged()) {
      if (event.cancelable) event.preventDefault();
      schedule({
        kind: "drag",
        distance: state.distance,
        progress: pullProgress(state),
      });
    } else if (state.origin === null) {
      untrack();
    }
  }

  function onTouchEnd(event: TouchEvent): void {
    untrack();
    const effect = feed({ type: "up" });
    if (effect === "release" || effect === "refresh") {
      if (event.cancelable) event.preventDefault();
    }
    if (effect === "refresh") void refresh();
  }

  function onTouchCancel(): void {
    cancel();
  }

  node.addEventListener("touchstart", onTouchStart, { passive: true });

  return {
    update(next) {
      options = next;
      if (!options.enabled && tracking) cancel();
    },
    destroy() {
      destroyed = true;
      untrack();
      node.removeEventListener("touchstart", onTouchStart);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
      stopSettling();
      clearStyles();
    },
  };
}
