import { describe, expect, it } from "vitest";
import { captureInstallEvents } from "./install-events";

function installPromptEvent(): Event {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, {
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  return event;
}

function setup() {
  const target = new EventTarget();
  const events = captureInstallEvents(target);
  let notifications = 0;
  events.subscribe(() => {
    notifications++;
  });
  return { target, events, count: () => notifications };
}

describe("captureInstallEvents", () => {
  it("stores a prevented beforeinstallprompt and notifies", () => {
    const { target, events, count } = setup();
    const event = installPromptEvent();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(events.deferredPrompt()).toBe(event);
    expect(count()).toBe(1);
  });

  it("replaces an earlier deferred install prompt", () => {
    const { target, events } = setup();
    const first = installPromptEvent();
    const second = installPromptEvent();
    target.dispatchEvent(first);
    target.dispatchEvent(second);
    expect(events.deferredPrompt()).toBe(second);
  });

  it("takePrompt returns then clears and notifies once", () => {
    const { target, events, count } = setup();
    const event = installPromptEvent();
    target.dispatchEvent(event);
    expect(events.takePrompt()).toBe(event);
    expect(events.deferredPrompt()).toBeNull();
    expect(count()).toBe(2);
    expect(events.takePrompt()).toBeNull();
    expect(count()).toBe(2);
  });

  it("appinstalled marks installed and clears the prompt", () => {
    const { target, events, count } = setup();
    expect(events.installed()).toBe(false);
    target.dispatchEvent(installPromptEvent());
    target.dispatchEvent(new Event("appinstalled"));
    expect(events.installed()).toBe(true);
    expect(events.deferredPrompt()).toBeNull();
    expect(count()).toBe(2);
  });

  it("stops notifying after unsubscribe", () => {
    const target = new EventTarget();
    const events = captureInstallEvents(target);
    let calls = 0;
    const unsubscribe = events.subscribe(() => {
      calls++;
    });
    target.dispatchEvent(installPromptEvent());
    unsubscribe();
    target.dispatchEvent(installPromptEvent());
    expect(calls).toBe(1);
  });

  it("stops capturing after dispose", () => {
    const { target, events, count } = setup();
    events.dispose();
    target.dispatchEvent(installPromptEvent());
    target.dispatchEvent(new Event("appinstalled"));
    expect(events.deferredPrompt()).toBeNull();
    expect(events.installed()).toBe(false);
    expect(count()).toBe(0);
  });
});
