import type { ActionReturn } from "svelte/action";
import {
  INITIAL_PULL,
  pullStep,
  type PullEvent,
  type PullState,
} from "./pull-to-refresh";

export interface PullGestureOptions {
  enabled: boolean;
  onChange: (state: PullState) => void;
  onRefresh: () => Promise<unknown>;
}

function sameState(a: PullState, b: PullState): boolean {
  return (
    a.phase === b.phase && a.origin === b.origin && a.distance === b.distance
  );
}

export function pullGesture(
  node: HTMLElement,
  initial: PullGestureOptions,
): ActionReturn<PullGestureOptions> {
  let options = initial;
  let state: PullState = INITIAL_PULL;
  let pointerId: number | null = null;
  let destroyed = false;

  function feed(event: PullEvent): void {
    const { state: next, effect } = pullStep(state, event);
    const changed = !sameState(state, next);
    state = next;
    if (changed && !destroyed) options.onChange(state);
    if (effect === "capture" && pointerId !== null) {
      node.setPointerCapture(pointerId);
    } else if (effect === "refresh") {
      void refresh();
    }
  }

  async function refresh(): Promise<void> {
    try {
      await options.onRefresh();
    } finally {
      feed({ type: "refreshed" });
    }
  }

  function endGesture(): void {
    if (pointerId !== null && node.hasPointerCapture(pointerId)) {
      node.releasePointerCapture(pointerId);
    }
    pointerId = null;
  }

  function isTracked(event: PointerEvent): boolean {
    return pointerId !== null && event.pointerId === pointerId;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!options.enabled || event.pointerType !== "touch" || !event.isPrimary) {
      return;
    }
    if (pointerId !== null || state.phase !== "idle") return;
    pointerId = event.pointerId;
    feed({ type: "down", y: event.clientY });
  }

  function onPointerMove(event: PointerEvent): void {
    if (!isTracked(event)) return;
    feed({ type: "move", y: event.clientY });
  }

  function onPointerUp(event: PointerEvent): void {
    if (!isTracked(event)) return;
    endGesture();
    feed({ type: "up" });
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!isTracked(event)) return;
    endGesture();
    feed({ type: "cancel" });
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (event.target !== node) return;
    onPointerCancel(event);
  }

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerCancel);
  node.addEventListener("lostpointercapture", onLostPointerCapture);

  return {
    update(next) {
      options = next;
      if (!options.enabled && pointerId !== null) {
        endGesture();
        feed({ type: "cancel" });
      }
    },
    destroy() {
      destroyed = true;
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerCancel);
      node.removeEventListener("lostpointercapture", onLostPointerCapture);
    },
  };
}
