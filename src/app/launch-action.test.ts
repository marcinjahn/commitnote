import { describe, expect, it } from "vitest";
import {
  createLaunchActions,
  parseLaunchAction,
  startLaunchActions,
  type LaunchAction,
  type LaunchParamsLike,
  type LaunchQueueLike,
} from "./launch-action";

const BOOT = "https://app.test/app/?action=new-note";

describe("parseLaunchAction", () => {
  it.each(["new-note", "search"] as const)("accepts %s", (action) => {
    expect(parseLaunchAction(`https://app.test/app/?action=${action}`)).toBe(
      action,
    );
  });

  it.each([
    "https://app.test/app/?action=delete",
    "https://app.test/app/?action=",
    "https://app.test/app/?action=New-Note",
    "https://app.test/app/",
    "https://app.test/app/#action=search",
    "https://app.test/app/?x=1#action=new-note",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(parseLaunchAction(url)).toBeNull();
  });

  it("finds the action among other parameters", () => {
    expect(parseLaunchAction("https://app.test/app/?x=1&action=search")).toBe(
      "search",
    );
  });
});

describe("createLaunchActions", () => {
  it("holds a delivery until attached and runs it once", () => {
    const actions = createLaunchActions();
    const ran: LaunchAction[] = [];
    actions.deliver("search");
    actions.attach((a) => ran.push(a));
    expect(ran).toEqual(["search"]);
    actions.attach((a) => ran.push(a));
    expect(ran).toEqual(["search"]);
  });

  it("keeps only the latest pending delivery", () => {
    const actions = createLaunchActions();
    const ran: LaunchAction[] = [];
    actions.deliver("search");
    actions.deliver("new-note");
    actions.attach((a) => ran.push(a));
    expect(ran).toEqual(["new-note"]);
  });

  it("runs deliveries immediately while attached", () => {
    const actions = createLaunchActions();
    const ran: LaunchAction[] = [];
    actions.attach((a) => ran.push(a));
    actions.deliver("search");
    actions.deliver("new-note");
    expect(ran).toEqual(["search", "new-note"]);
  });

  it("holds again after detach", () => {
    const actions = createLaunchActions();
    const ran: LaunchAction[] = [];
    const detach = actions.attach((a) => ran.push(a));
    detach();
    actions.deliver("search");
    expect(ran).toEqual([]);
    actions.attach((a) => ran.push(a));
    expect(ran).toEqual(["search"]);
  });

  it("lets a newer attach replace the previous handler", () => {
    const actions = createLaunchActions();
    const first: LaunchAction[] = [];
    const second: LaunchAction[] = [];
    const detachFirst = actions.attach((a) => first.push(a));
    actions.attach((a) => second.push(a));
    detachFirst();
    actions.deliver("search");
    expect(first).toEqual([]);
    expect(second).toEqual(["search"]);
  });
});

class FakeLaunchQueue implements LaunchQueueLike {
  consumer: ((params: LaunchParamsLike) => void) | null = null;

  setConsumer(consumer: (params: LaunchParamsLike) => void): void {
    this.consumer = consumer;
  }

  launch(params: LaunchParamsLike): void {
    this.consumer?.(params);
  }
}

function start(bootHref: string, launchQueue?: LaunchQueueLike) {
  let cleared = 0;
  const actions = startLaunchActions({
    bootHref,
    launchQueue,
    clearUrl: () => {
      cleared++;
    },
  });
  const ran: LaunchAction[] = [];
  return {
    actions,
    ran,
    attach: () => actions.attach((a) => ran.push(a)),
    cleared: () => cleared,
  };
}

describe("startLaunchActions", () => {
  it("delivers the boot action and clears the URL", () => {
    const s = start(BOOT);
    s.attach();
    expect(s.ran).toEqual(["new-note"]);
    expect(s.cleared()).toBe(1);
  });

  it("clears the URL for an invalid action without delivering", () => {
    const s = start("https://app.test/app/?action=bogus");
    s.attach();
    expect(s.ran).toEqual([]);
    expect(s.cleared()).toBe(1);
  });

  it("does not clear the URL without an action parameter", () => {
    const s = start("https://app.test/app/?x=1#action=search");
    s.attach();
    expect(s.ran).toEqual([]);
    expect(s.cleared()).toBe(0);
  });

  it("works without a launchQueue", () => {
    const s = start("https://app.test/app/");
    s.attach();
    expect(s.ran).toEqual([]);
  });

  it("skips the first launch equal to the boot URL", () => {
    const queue = new FakeLaunchQueue();
    const s = start(BOOT, queue);
    s.attach();
    queue.launch({ targetURL: BOOT });
    expect(s.ran).toEqual(["new-note"]);
  });

  it("delivers a later launch identical to the boot URL", () => {
    const queue = new FakeLaunchQueue();
    const s = start(BOOT, queue);
    s.attach();
    queue.launch({ targetURL: BOOT });
    queue.launch({ targetURL: BOOT });
    expect(s.ran).toEqual(["new-note", "new-note"]);
  });

  it("delivers a first launch with a different target", () => {
    const queue = new FakeLaunchQueue();
    const s = start(BOOT, queue);
    s.attach();
    queue.launch({ targetURL: "https://app.test/app/?action=search" });
    expect(s.ran).toEqual(["new-note", "search"]);
  });

  it("ignores launches without a target and does not count them as first", () => {
    const queue = new FakeLaunchQueue();
    const s = start(BOOT, queue);
    s.attach();
    queue.launch({});
    queue.launch({ targetURL: null });
    queue.launch({ targetURL: BOOT });
    expect(s.ran).toEqual(["new-note"]);
  });

  it("ignores launches with an invalid action", () => {
    const queue = new FakeLaunchQueue();
    const s = start("https://app.test/app/", queue);
    s.attach();
    queue.launch({ targetURL: "https://app.test/app/?action=bogus" });
    expect(s.ran).toEqual([]);
  });

  it("holds a launch delivered before the notes screen is ready", () => {
    const queue = new FakeLaunchQueue();
    const s = start("https://app.test/app/", queue);
    queue.launch({ targetURL: "https://app.test/app/?action=search" });
    s.attach();
    expect(s.ran).toEqual(["search"]);
  });
});
