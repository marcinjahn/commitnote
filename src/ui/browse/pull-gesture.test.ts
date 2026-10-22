import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pullGesture,
  type PullClock,
  type PullGestureOptions,
} from "./pull-gesture";
import { PULL_THRESHOLDS, type PullPhase } from "./pull-to-refresh";

const ORIGIN = 100;
const PULLING_Y = ORIGIN + 40;
const ARMED_Y = ORIGIN + 200;

function rubberBand(dy: number): number {
  const travel = Math.max(0, dy - PULL_THRESHOLDS.slop);
  return PULL_THRESHOLDS.max * (1 - 1 / (1 + travel / PULL_THRESHOLDS.max));
}

class FakeStyle {
  transform = "";
  transition = "";
  willChange = "";
  readonly custom = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.custom.set(name, value);
  }
  removeProperty(name: string): string {
    const value = this.custom.get(name) ?? "";
    this.custom.delete(name);
    return value;
  }
  getPropertyValue(name: string): string {
    return this.custom.get(name) ?? "";
  }
}

class FakeElement extends EventTarget {
  readonly style = new FakeStyle();
  readonly addEventListener = vi.fn(super.addEventListener.bind(this));
  readonly removeEventListener = vi.fn(super.removeEventListener.bind(this));
}

class FakeClock implements PullClock {
  time = 0;
  private timers: { at: number; fn: () => void }[] = [];
  readonly setTimeout = vi.fn((fn: () => void, ms: number) => {
    this.timers.push({ at: this.time + ms, fn });
  });
  now(): number {
    return this.time;
  }
  advance(ms: number): void {
    this.time += ms;
    const due = this.timers.filter((timer) => timer.at <= this.time);
    this.timers = this.timers.filter((timer) => timer.at > this.time);
    for (const timer of due) timer.fn();
  }
}

type TouchInit = {
  readonly y?: number;
  readonly t?: number;
  readonly fingers?: number;
};

function touchEvent(type: string, init: TouchInit = {}) {
  const fingers = init.fingers ?? (type === "touchend" ? 0 : 1);
  const touch = { identifier: 0, clientX: 50, clientY: init.y ?? ORIGIN };
  const event = Object.assign(new Event(type, { cancelable: true }), {
    touches: Array.from({ length: fingers }, (_, i) => ({
      ...touch,
      identifier: i,
    })),
    changedTouches: [touch],
    preventDefault: vi.fn(),
  });
  Object.defineProperty(event, "timeStamp", { value: init.t ?? 0 });
  return event;
}

let frames: FrameRequestCallback[] = [];

function runFrames(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(0);
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flushPromises = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<PullGestureOptions> = {}) {
  const node = new FakeElement();
  const content = new FakeElement();
  const chip = new FakeElement();
  const clock = new FakeClock();
  const phases: PullPhase[] = [];
  let settleRefresh: (ok: boolean) => void = () => {};
  const onRefresh = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settleRefresh = (ok) => (ok ? resolve() : reject(new Error("failed")));
      }),
  );
  const options: PullGestureOptions = {
    enabled: true,
    atTop: () => true,
    content: () => content as unknown as HTMLElement,
    indicator: () => chip as unknown as HTMLElement,
    onChange: (phase) => phases.push(phase),
    onRefresh,
    clock,
    reducedMotion: () => false,
    ...overrides,
  };
  const action = pullGesture(node as unknown as HTMLElement, options);
  const send = (type: string, init?: TouchInit) => {
    const event = touchEvent(type, init);
    node.dispatchEvent(event);
    return event;
  };
  return {
    node,
    content,
    chip,
    clock,
    phases,
    onRefresh,
    action,
    options,
    send,
    resolveRefresh: () => settleRefresh(true),
    rejectRefresh: () => settleRefresh(false),
    phase: () => phases.at(-1) ?? "idle",
    pullTo: (y: number) => {
      send("touchstart");
      return send("touchmove", { y });
    },
    springBack: () => {
      runFrames();
      clock.advance(300);
    },
  };
}

function listenerCalls(
  spy: FakeElement["addEventListener"] | FakeElement["removeEventListener"],
  type: string,
) {
  return spy.mock.calls.filter(([name]) => name === type);
}

describe("pullGesture listeners", () => {
  it("listens for touchstart passively and for nothing else until a touch starts", () => {
    const g = setup();

    expect(listenerCalls(g.node.addEventListener, "touchstart")).toEqual([
      ["touchstart", expect.any(Function), { passive: true }],
    ]);
    expect(listenerCalls(g.node.addEventListener, "touchmove")).toEqual([]);
  });

  it("adds a non-passive touchmove listener after an at-top start and removes it on touchend", () => {
    const g = setup();
    g.send("touchstart");

    expect(listenerCalls(g.node.addEventListener, "touchmove")).toEqual([
      ["touchmove", expect.any(Function), { passive: false }],
    ]);

    g.send("touchend");
    expect(listenerCalls(g.node.removeEventListener, "touchmove")).toHaveLength(
      1,
    );
    expect(listenerCalls(g.node.removeEventListener, "touchend")).toHaveLength(
      1,
    );
    expect(
      listenerCalls(g.node.removeEventListener, "touchcancel"),
    ).toHaveLength(1);
  });

  it("removes the touch listeners on touchcancel", () => {
    const g = setup();
    g.send("touchstart");
    g.send("touchcancel");

    expect(listenerCalls(g.node.removeEventListener, "touchmove")).toHaveLength(
      1,
    );
  });

  it.each([
    ["the surface is scrolled", { atTop: () => false }],
    ["the start is vetoed", { canStart: () => false }],
    ["the gesture is disabled", { enabled: false }],
  ])("adds no touchmove listener when %s", (_, overrides) => {
    const g = setup(overrides);
    g.send("touchstart");
    g.send("touchmove", { y: ARMED_Y });
    g.send("touchend");

    expect(listenerCalls(g.node.addEventListener, "touchmove")).toEqual([]);
    expect(g.phases).toEqual([]);
  });

  it("ignores a start with two fingers down", () => {
    const g = setup();
    g.send("touchstart", { fingers: 2 });

    expect(listenerCalls(g.node.addEventListener, "touchmove")).toEqual([]);
  });

  it("removes every listener on destroy", () => {
    const g = setup();
    g.send("touchstart");
    g.action.destroy?.();

    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      expect(listenerCalls(g.node.removeEventListener, type)).not.toEqual([]);
    }
  });
});

describe("pullGesture default handling", () => {
  it("leaves moves within the slop alone and prevents them from the engaging move on", () => {
    const g = setup();
    g.send("touchstart");
    const within = g.send("touchmove", { y: ORIGIN + PULL_THRESHOLDS.slop });
    expect(within.preventDefault).not.toHaveBeenCalled();
    expect(g.phases).toEqual([]);

    const engaging = g.send("touchmove", {
      y: ORIGIN + PULL_THRESHOLDS.slop + 2,
    });
    expect(engaging.preventDefault).toHaveBeenCalledOnce();
    expect(g.phase()).toBe("pulling");

    const later = g.send("touchmove", { y: ORIGIN + 5 });
    expect(later.preventDefault).toHaveBeenCalledOnce();
  });

  it("stops listening once an upward move abandons the pull", () => {
    const g = setup();
    g.send("touchstart");
    const up = g.send("touchmove", { y: ORIGIN - 20 });

    expect(up.preventDefault).not.toHaveBeenCalled();
    expect(listenerCalls(g.node.removeEventListener, "touchmove")).toHaveLength(
      1,
    );
  });

  it("does not engage a pull that starts after a long press", () => {
    const g = setup();
    g.send("touchstart", { t: 0 });
    const move = g.send("touchmove", {
      y: ARMED_Y,
      t: PULL_THRESHOLDS.longPress,
    });

    expect(move.preventDefault).not.toHaveBeenCalled();
    expect(g.phases).toEqual([]);
  });

  it("prevents the touchend of an unarmed release", () => {
    const g = setup();
    g.pullTo(PULLING_Y);
    const end = g.send("touchend");

    expect(end.preventDefault).toHaveBeenCalledOnce();
    expect(g.onRefresh).not.toHaveBeenCalled();
    expect(g.phases).toEqual(["pulling", "idle"]);
  });

  it("prevents the touchend of an armed release", () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    const end = g.send("touchend");

    expect(end.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves the touchend of a tap alone", () => {
    const g = setup();
    g.send("touchstart");
    const end = g.send("touchend");

    expect(end.preventDefault).not.toHaveBeenCalled();
    expect(g.phases).toEqual([]);
  });
});

describe("pullGesture cancellation", () => {
  it("cancels when a second finger touches down", () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchstart", { fingers: 2 });

    expect(g.phase()).toBe("idle");
    g.send("touchend");
    expect(g.onRefresh).not.toHaveBeenCalled();
  });

  it("cancels when a move carries a second finger", () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchmove", { y: ARMED_Y, fingers: 2 });

    expect(g.phase()).toBe("idle");
    expect(listenerCalls(g.node.removeEventListener, "touchmove")).toHaveLength(
      1,
    );
  });

  it("cancels on touchcancel", () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchcancel");

    expect(g.phase()).toBe("idle");
    expect(g.onRefresh).not.toHaveBeenCalled();
  });

  it("a new touch after a lost touchend starts a fresh pull", () => {
    const g = setup();
    g.send("touchstart", { y: ARMED_Y + 200 });
    g.send("touchstart");
    g.send("touchmove", { y: ARMED_Y });
    g.send("touchend");

    expect(g.onRefresh).toHaveBeenCalledTimes(1);
    expect(g.phases.slice(-2)).toEqual(["armed", "refreshing"]);
  });

  it("a new touch after a lost touchend springs a moved pull home", () => {
    let atTop = true;
    const g = setup({ atTop: () => atTop });
    g.pullTo(PULLING_Y);
    runFrames();
    atTop = false;
    g.send("touchstart");

    expect(g.phase()).toBe("idle");
    g.springBack();
    expect(g.content.style.transform).toBe("");
    expect(g.chip.style.transform).toBe("");
  });

  it("cancels an unreleased pull when disabled", () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.action.update?.({ ...g.options, enabled: false });

    expect(g.phase()).toBe("idle");
    g.send("touchend");
    expect(g.onRefresh).not.toHaveBeenCalled();
  });

  it("keeps refreshing when disabled during a refresh", async () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchend");
    g.action.update?.({ ...g.options, enabled: false });
    expect(g.phase()).toBe("refreshing");

    g.resolveRefresh();
    await flushPromises();
    g.clock.advance(500);
    await vi.waitFor(() => expect(g.phase()).toBe("idle"));
  });
});

describe("pullGesture refresh", () => {
  it("refreshes once on an armed release and reports refreshing", () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    expect(g.phase()).toBe("armed");
    g.send("touchend");

    expect(g.onRefresh).toHaveBeenCalledOnce();
    expect(g.phases).toEqual(["armed", "refreshing"]);

    g.pullTo(ARMED_Y);
    g.send("touchend");
    expect(g.onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps an instant refresh spinning for the minimum time", async () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchend");
    g.resolveRefresh();
    await flushPromises();
    expect(g.phase()).toBe("refreshing");

    g.clock.advance(499);
    await flushPromises();
    expect(g.phase()).toBe("refreshing");

    g.clock.advance(1);
    await vi.waitFor(() => expect(g.phase()).toBe("idle"));
  });

  it("ends a slow refresh right after it settles", async () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchend");
    g.clock.advance(700);
    g.resolveRefresh();

    await vi.waitFor(() => expect(g.phase()).toBe("idle"));
    expect(g.clock.setTimeout).not.toHaveBeenCalled();
  });

  it("ends refreshing when the refresh rejects", async () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    g.send("touchend");
    g.clock.advance(700);
    g.rejectRefresh();

    await vi.waitFor(() => expect(g.phase()).toBe("idle"));
  });
});

describe("pullGesture rendering", () => {
  it("coalesces moves into one style write per frame", () => {
    const g = setup();
    g.send("touchstart");
    g.send("touchmove", { y: ORIGIN + 30 });
    g.send("touchmove", { y: ORIGIN + 60 });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(g.content.style.transform).toBe("");

    runFrames();
    expect(g.content.style.transform).toBe(`translateY(${rubberBand(60)}px)`);
  });

  it("moves content and chip with the rubber band and clears them after the spring-back", () => {
    const g = setup();
    g.pullTo(PULLING_Y);
    runFrames();

    const distance = rubberBand(PULLING_Y - ORIGIN);
    expect(g.content.style.transform).toBe(`translateY(${distance}px)`);
    expect(g.chip.style.transform).toBe(`translateY(${(distance - 32) / 2}px)`);
    expect(g.chip.style.getPropertyValue("--pull-progress")).toBe(
      String(distance / PULL_THRESHOLDS.arm),
    );
    expect(g.content.style.willChange).toBe("transform");
    expect(g.chip.style.willChange).toBe("transform");

    g.send("touchend");
    runFrames();
    expect(g.content.style.transform).toBe("translateY(0px)");
    expect(g.content.style.transition).toContain("transform 260ms");
    expect(g.chip.style.transition).toContain("opacity 260ms");
    expect(g.chip.style.getPropertyValue("--pull-progress")).toBe("0");

    g.content.dispatchEvent(
      Object.assign(new Event("transitionend"), { propertyName: "transform" }),
    );
    for (const el of [g.content, g.chip]) {
      expect(el.style.transform).toBe("");
      expect(el.style.transition).toBe("");
      expect(el.style.willChange).toBe("");
    }
    expect(g.chip.style.getPropertyValue("--pull-progress")).toBe("");
  });

  it("clears the styles after the fallback when no transitionend arrives", () => {
    const g = setup();
    g.pullTo(PULLING_Y);
    runFrames();
    g.send("touchcancel");
    runFrames();
    expect(g.content.style.transform).toBe("translateY(0px)");

    g.clock.advance(300);
    expect(g.content.style.transform).toBe("");
    expect(g.chip.style.transform).toBe("");
  });

  it("springs an armed release to the rest offset and home after the refresh", async () => {
    const g = setup();
    g.pullTo(ARMED_Y);
    runFrames();
    g.send("touchend");
    runFrames();

    expect(g.content.style.transform).toBe(
      `translateY(${PULL_THRESHOLDS.rest}px)`,
    );
    expect(g.chip.style.transform).toBe("translateY(8px)");
    expect(g.chip.style.getPropertyValue("--pull-progress")).toBe("1");

    g.clock.advance(700);
    g.resolveRefresh();
    await vi.waitFor(() => expect(g.phase()).toBe("idle"));
    g.springBack();
    expect(g.content.style.transform).toBe("");
    expect(g.chip.style.transform).toBe("");
  });

  it("writes only the chip without pull content", () => {
    const g = setup({ content: () => null });
    g.pullTo(PULLING_Y);
    runFrames();

    expect(g.content.style.transform).toBe("");
    expect(g.chip.style.transform).not.toBe("");

    g.send("touchend");
    g.springBack();
    expect(g.chip.style.transform).toBe("");
  });

  it("never moves the content with reduced motion", () => {
    const g = setup({ reducedMotion: () => true });
    g.pullTo(PULLING_Y);
    runFrames();

    expect(g.content.style.transform).toBe("");
    expect(g.chip.style.transform).toBe("translateY(8px)");
    expect(g.chip.style.transition).toBe("");
    expect(g.chip.style.getPropertyValue("--pull-progress")).not.toBe("");

    g.send("touchend");
    runFrames();
    expect(g.chip.style.transform).toBe("");
    expect(g.content.style.transform).toBe("");
  });

  it("clears its styles and pending frame on destroy", () => {
    const g = setup();
    g.pullTo(PULLING_Y);
    runFrames();
    g.send("touchmove", { y: ORIGIN + 60 });
    g.action.destroy?.();

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(g.content.style.transform).toBe("");
    expect(g.chip.style.transform).toBe("");
  });
});
