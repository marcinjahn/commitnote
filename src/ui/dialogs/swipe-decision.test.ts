import { describe, expect, it } from "vitest";
import {
  createVelocityTracker,
  swipeArming,
  swipeDecision,
} from "./swipe-decision";

describe("swipeDecision", () => {
  const cardHeight = 500;

  it("snaps back just below 30% of card height at rest", () => {
    expect(swipeDecision(149, cardHeight, 0)).toBe("snap-back");
  });

  it("closes at exactly 30% of card height", () => {
    expect(swipeDecision(150, cardHeight, 0)).toBe("close");
  });

  it("closes above 30% of card height", () => {
    expect(swipeDecision(300, cardHeight, 0)).toBe("close");
  });

  it("closes a short swipe released at 0.5 px/ms", () => {
    expect(swipeDecision(20, cardHeight, 0.5)).toBe("close");
  });

  it("closes a short swipe released faster than 0.5 px/ms", () => {
    expect(swipeDecision(20, cardHeight, 2)).toBe("close");
  });

  it("snaps back a short slow swipe", () => {
    expect(swipeDecision(20, cardHeight, 0.49)).toBe("snap-back");
  });

  it("snaps back an upward offset even with high velocity", () => {
    expect(swipeDecision(-50, cardHeight, 3)).toBe("snap-back");
  });

  it("snaps back a zero offset even with high velocity", () => {
    expect(swipeDecision(0, cardHeight, 3)).toBe("snap-back");
  });

  it("does not meet the distance threshold for a zero-height card", () => {
    expect(swipeDecision(10, 0, 0)).toBe("snap-back");
  });
});

describe("createVelocityTracker", () => {
  it("reports px/ms for steady downward samples", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 1000);
    tracker.add(10, 1020);
    tracker.add(20, 1040);
    expect(tracker.velocity(1040)).toBeCloseTo(0.5);
  });

  it("ignores samples older than the window", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 1000);
    tracker.add(200, 1010);
    tracker.add(210, 1190);
    tracker.add(220, 1250);
    expect(tracker.velocity(1250)).toBeCloseTo(10 / 60);
  });

  it("reports 0 after a pause longer than the window", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 1000);
    tracker.add(50, 1050);
    expect(tracker.velocity(1200)).toBe(0);
  });

  it("reports 0 for a single sample", () => {
    const tracker = createVelocityTracker();
    tracker.add(10, 1000);
    expect(tracker.velocity(1000)).toBe(0);
  });

  it("reports 0 when samples share a timestamp", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 1000);
    tracker.add(30, 1000);
    expect(tracker.velocity(1000)).toBe(0);
  });

  it("reports 0 after reset", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 1000);
    tracker.add(50, 1050);
    tracker.reset();
    expect(tracker.velocity(1050)).toBe(0);
  });
});

describe("swipeArming", () => {
  it("stays pending below the movement slop", () => {
    expect(swipeArming(3, 5)).toBe("pending");
  });

  it("aborts when horizontal movement dominates", () => {
    expect(swipeArming(20, 10)).toBe("aborted");
  });

  it("aborts when movement is diagonal at equal magnitude", () => {
    expect(swipeArming(12, 12)).toBe("aborted");
  });

  it("aborts when upward movement dominates", () => {
    expect(swipeArming(1, -15)).toBe("aborted");
  });

  it("arms on mostly vertical downward movement past the slop", () => {
    expect(swipeArming(3, 12)).toBe("armed");
  });
});
