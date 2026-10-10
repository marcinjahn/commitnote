import type { ActionReturn } from "svelte/action";
import {
  DRAG_MOTION_MS,
  isNarrowLayout,
  prefersReducedMotion,
} from "../browse/drag-motion";
import {
  createVelocityTracker,
  swipeArming,
  swipeDecision,
} from "./swipe-decision";

export type SwipeToCloseOptions = { enabled: boolean; onClose: () => void };

const INTERACTIVE = "button, a, input, select, textarea, [role='button']";

export function swipeToClose(
  header: HTMLElement,
  initial: SwipeToCloseOptions,
): ActionReturn<SwipeToCloseOptions> {
  let options = initial;
  let card: HTMLElement | null = null;
  let dialog: HTMLDialogElement | null = null;
  let gesture: {
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    armed: boolean;
    offset: number;
  } | null = null;
  let stopSettling: (() => void) | null = null;
  let closeCheckTimer: ReturnType<typeof setTimeout> | undefined;
  const tracker = createVelocityTracker();

  function resolveElements(): boolean {
    card ??= header.closest<HTMLElement>(".dialog-card");
    if (dialog === null) {
      dialog = header.closest("dialog");
      dialog?.addEventListener("close", onDialogClose);
    }
    return card !== null && dialog !== null;
  }

  function apply(offset: number, progress: number): void {
    if (card === null || dialog === null) return;
    card.style.transform = `translateY(${offset}px)`;
    dialog.style.setProperty("--swipe-progress", String(progress));
  }

  function clear(): void {
    stopSettling?.();
    stopSettling = null;
    clearTimeout(closeCheckTimer);
    closeCheckTimer = undefined;
    card?.style.removeProperty("transform");
    if (dialog !== null) {
      dialog.style.removeProperty("--swipe-progress");
      delete dialog.dataset.swipe;
    }
  }

  function settle(offset: number, progress: number, then: () => void): void {
    if (card === null || dialog === null) return;
    if (prefersReducedMotion()) {
      delete dialog.dataset.swipe;
      apply(offset, progress);
      then();
      return;
    }
    const target = card;
    dialog.dataset.swipe = "settling";
    apply(offset, progress);
    const done = () => {
      target.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      stopSettling = null;
      then();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === target && event.propertyName === "transform") {
        done();
      }
    };
    target.addEventListener("transitionend", onEnd);
    const timer = setTimeout(done, DRAG_MOTION_MS + 100);
    stopSettling = () => {
      target.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
    };
  }

  function snapBack(): void {
    settle(0, 0, clear);
  }

  function close(): void {
    if (card === null) return;
    settle(card.offsetHeight, 1, () => {
      if (dialog !== null) dialog.dataset.swipe = "closed";
      options.onClose();
      closeCheckTimer = setTimeout(() => {
        closeCheckTimer = undefined;
        if (dialog !== null && dialog.isConnected && dialog.open) snapBack();
      }, 0);
    });
  }

  function endGesture(): void {
    if (gesture !== null && header.hasPointerCapture(gesture.pointerId)) {
      header.releasePointerCapture(gesture.pointerId);
    }
    gesture = null;
  }

  function onPointerDown(event: PointerEvent): void {
    if (
      !options.enabled ||
      (event.pointerType !== "touch" && event.pointerType !== "pen") ||
      !isNarrowLayout() ||
      stopSettling !== null ||
      closeCheckTimer !== undefined ||
      gesture !== null ||
      (event.target as Element).closest(INTERACTIVE) !== null ||
      !resolveElements()
    ) {
      return;
    }
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      armed: false,
      offset: 0,
    };
    tracker.reset();
    tracker.add(event.clientY, event.timeStamp);
  }

  function onPointerMove(event: PointerEvent): void {
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    if (!gesture.armed) {
      const arming = swipeArming(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      );
      if (arming === "aborted") {
        gesture = null;
        return;
      }
      if (arming === "pending") {
        tracker.add(event.clientY, event.timeStamp);
        return;
      }
      gesture.armed = true;
      header.setPointerCapture(gesture.pointerId);
      if (dialog !== null) dialog.dataset.swipe = "dragging";
    }
    if (card === null) return;
    gesture.offset = Math.max(0, event.clientY - gesture.startY);
    tracker.add(event.clientY, event.timeStamp);
    apply(gesture.offset, Math.min(1, gesture.offset / card.offsetHeight));
  }

  function onPointerUp(event: PointerEvent): void {
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    const { armed, offset } = gesture;
    endGesture();
    if (!armed || card === null) return;
    const decision = swipeDecision(
      offset,
      card.offsetHeight,
      tracker.velocity(event.timeStamp),
    );
    if (decision === "close") close();
    else snapBack();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (gesture === null || event.pointerId !== gesture.pointerId) return;
    const { armed } = gesture;
    endGesture();
    if (armed) snapBack();
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (event.target !== header) return;
    onPointerCancel(event);
  }

  function onDialogClose(): void {
    endGesture();
    clear();
  }

  header.addEventListener("pointerdown", onPointerDown);
  header.addEventListener("pointermove", onPointerMove);
  header.addEventListener("pointerup", onPointerUp);
  header.addEventListener("pointercancel", onPointerCancel);
  header.addEventListener("lostpointercapture", onLostPointerCapture);

  return {
    update(next) {
      options = next;
      if (!options.enabled && gesture !== null) {
        const { armed } = gesture;
        endGesture();
        if (armed) snapBack();
      }
    },
    destroy() {
      header.removeEventListener("pointerdown", onPointerDown);
      header.removeEventListener("pointermove", onPointerMove);
      header.removeEventListener("pointerup", onPointerUp);
      header.removeEventListener("pointercancel", onPointerCancel);
      header.removeEventListener("lostpointercapture", onLostPointerCapture);
      dialog?.removeEventListener("close", onDialogClose);
      stopSettling?.();
      stopSettling = null;
      clearTimeout(closeCheckTimer);
    },
  };
}
