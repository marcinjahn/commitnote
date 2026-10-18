import { describe, expect, it } from "vitest";
import { preventGestureZoom } from "./gesture-zoom-guard";

function dispatch(target: EventTarget, type: string): Event {
  const event = new Event(type, { cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("preventGestureZoom", () => {
  it.each(["gesturestart", "gesturechange"])("cancels %s", (type) => {
    const target = new EventTarget();
    preventGestureZoom(target);
    expect(dispatch(target, type).defaultPrevented).toBe(true);
  });

  it.each(["gesturestart", "gesturechange"])(
    "stops cancelling %s after stop()",
    (type) => {
      const target = new EventTarget();
      const stop = preventGestureZoom(target);
      stop();
      expect(dispatch(target, type).defaultPrevented).toBe(false);
    },
  );
});
