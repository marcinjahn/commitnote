import { describe, expect, it } from "vitest";
import { createTestClock } from "../../sync/testing/test-clock";
import {
  createNoteSwitchMotion,
  LOADING_REVEAL_DELAY_MS,
  type NoteSwitchView,
} from "./note-switch-motion";

function setup() {
  const clock = createTestClock();
  const views: NoteSwitchView[] = [];
  const events: string[] = [];
  const motion = createNoteSwitchMotion({
    clock,
    onView: (view) => {
      views.push(view);
      events.push(`view:${view.held}:${view.loadingRevealed}`);
    },
    onLeave: () => events.push("leave"),
    onEnter: () => events.push("enter"),
  });
  const count = (name: string) => events.filter((e) => e === name).length;
  return {
    clock,
    motion,
    views,
    events,
    enters: () => count("enter"),
    leaves: () => count("leave"),
    latest: () => views.at(-1) ?? { held: false, loadingRevealed: false },
  };
}

describe("createNoteSwitchMotion", () => {
  it("plays nothing for the baseline update", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 5, target: "presentable" });
    expect(t.events).toEqual([]);
  });

  it("enters once without holding when switching to a presentable target", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "presentable" });
    expect(t.enters()).toBe(1);
    expect(t.leaves()).toBe(0);
    expect(t.views).toEqual([]);
  });

  it("holds and leaves while loading, then enters once when presentable", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "loading" });
    expect(t.latest()).toEqual({ held: true, loadingRevealed: false });
    expect(t.leaves()).toBe(1);
    expect(t.enters()).toBe(0);

    t.motion.update({ noteSwitch: 1, target: "loading" });
    expect(t.leaves()).toBe(1);

    t.motion.update({ noteSwitch: 1, target: "presentable" });
    expect(t.latest()).toEqual({ held: false, loadingRevealed: false });
    expect(t.enters()).toBe(1);

    t.motion.update({ noteSwitch: 1, target: "presentable" });
    expect(t.enters()).toBe(1);
  });

  it("reveals loading only after the delay", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "loading" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS - 1);
    expect(t.latest().loadingRevealed).toBe(false);
    t.clock.advance(1);
    expect(t.latest()).toEqual({ held: true, loadingRevealed: true });
  });

  it("never reveals loading when the target becomes presentable first", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "loading" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS - 1);
    t.motion.update({ noteSwitch: 1, target: "presentable" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS * 2);
    expect(t.views.some((v) => v.loadingRevealed)).toBe(false);
    expect(t.enters()).toBe(1);
  });

  it("ends a rapid sequence of switches with one enter for the newest", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    for (const noteSwitch of [1, 2, 3]) {
      t.motion.update({ noteSwitch, target: "loading" });
      t.clock.advance(LOADING_REVEAL_DELAY_MS - 100);
    }
    expect(t.enters()).toBe(0);
    expect(t.leaves()).toBe(3);
    t.motion.update({ noteSwitch: 3, target: "presentable" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS * 2);
    expect(t.enters()).toBe(1);
    expect(t.views.some((v) => v.loadingRevealed)).toBe(false);
    expect(t.latest()).toEqual({ held: false, loadingRevealed: false });
  });

  it("restarts the reveal timer on a new switch while loading", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "loading" });
    t.clock.advance(300);
    t.motion.update({ noteSwitch: 2, target: "loading" });
    t.clock.advance(300);
    expect(t.latest().loadingRevealed).toBe(false);
    t.clock.advance(100);
    expect(t.latest().loadingRevealed).toBe(true);
  });

  it("enters for a new presentable switch while a previous one was held", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "loading" });
    t.motion.update({ noteSwitch: 2, target: "presentable" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS * 2);
    expect(t.latest()).toEqual({ held: false, loadingRevealed: false });
    expect(t.enters()).toBe(1);
  });

  it("plays nothing when the switch counter is unchanged", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 4, target: "presentable" });
    t.motion.update({ noteSwitch: 4, target: "presentable" });
    t.motion.update({ noteSwitch: 4, target: "presentable" });
    expect(t.events).toEqual([]);
  });

  it("reveals a load not caused by a switch without hold, leave or enter", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 0, target: "loading" });
    expect(t.views).toEqual([]);
    t.clock.advance(LOADING_REVEAL_DELAY_MS - 1);
    expect(t.views).toEqual([]);
    t.clock.advance(1);
    expect(t.latest()).toEqual({ held: false, loadingRevealed: true });

    t.motion.update({ noteSwitch: 0, target: "loading" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS * 2);
    expect(t.views).toHaveLength(1);

    t.motion.update({ noteSwitch: 0, target: "presentable" });
    expect(t.latest()).toEqual({ held: false, loadingRevealed: false });
    expect(t.enters()).toBe(0);
    expect(t.leaves()).toBe(0);
  });

  it("reveals a loading baseline without hold", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "loading" });
    t.clock.advance(LOADING_REVEAL_DELAY_MS);
    expect(t.latest()).toEqual({ held: false, loadingRevealed: true });
    expect(t.leaves()).toBe(0);
    expect(t.enters()).toBe(0);
  });

  it("stops a pending reveal on dispose", () => {
    const t = setup();
    t.motion.update({ noteSwitch: 0, target: "presentable" });
    t.motion.update({ noteSwitch: 1, target: "loading" });
    t.motion.dispose();
    t.clock.advance(LOADING_REVEAL_DELAY_MS * 2);
    expect(t.views.some((v) => v.loadingRevealed)).toBe(false);
  });
});
