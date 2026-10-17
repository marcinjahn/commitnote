import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClock } from "../sync/testing/test-clock";
import { UPDATE_CHECK_INTERVAL_MS, startAppUpdates } from "./app-updates";

class FakeWorker extends EventTarget {
  state = "installing";
  postMessage = vi.fn();
  setState(state: string): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  active: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn<() => Promise<void>>(() => Promise.resolve());
}

class FakeContainer extends EventTarget {
  controller: object | null = {};
  registration = new FakeRegistration();
  register = vi.fn(
    (_url: string, _options: { updateViaCache: "none" }): Promise<FakeRegistration | undefined> =>
      Promise.resolve(this.registration),
  );
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(
  options: { controlled?: boolean; active?: boolean; waiting?: boolean } = {},
) {
  const container = new FakeContainer();
  if (options.controlled === false) container.controller = null;
  if (options.active ?? true) container.registration.active = new FakeWorker();
  if (options.waiting) container.registration.waiting = new FakeWorker();
  const clock = createTestClock(1_000_000);
  const reload = vi.fn();
  const updates = startAppUpdates({
    container,
    scriptUrl: "./sw.js",
    clock,
    reload,
  });
  const notifications: boolean[] = [];
  updates.subscribe((value) => notifications.push(value));
  return { container, registration: container.registration, clock, reload, updates, notifications };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registration", () => {
  it("registers the script bypassing the http cache", async () => {
    const { container } = setup();
    await flush();
    expect(container.register).toHaveBeenCalledWith("./sw.js", {
      updateViaCache: "none",
    });
  });

  it("checks for an update at start when a worker was already active", async () => {
    const { registration } = setup({ active: true });
    await flush();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("does not check at start on a first install", async () => {
    const { registration } = setup({ active: false });
    await flush();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it("swallows a register rejection silently", async () => {
    const container = new FakeContainer();
    container.register.mockRejectedValue(new Error("blocked"));
    const spies = (["error", "warn", "log"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const updates = startAppUpdates({
      container,
      scriptUrl: "./sw.js",
      clock: createTestClock(0),
      reload: vi.fn(),
    });
    await flush();
    updates.checkForUpdate();
    expect(updates.updateWaiting).toBe(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("stays inert when register resolves without a registration", async () => {
    const container = new FakeContainer();
    container.register.mockResolvedValue(undefined);
    const updates = startAppUpdates({
      container,
      scriptUrl: "./sw.js",
      clock: createTestClock(0),
      reload: vi.fn(),
    });
    await flush();
    updates.checkForUpdate();
    updates.skipWaiting();
    expect(updates.updateWaiting).toBe(false);
  });

  it("swallows an update rejection silently", async () => {
    const container = new FakeContainer();
    container.registration.active = new FakeWorker();
    container.registration.update.mockRejectedValue(new Error("offline"));
    const spies = (["error", "warn", "log"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const clock = createTestClock(0);
    const updates = startAppUpdates({
      container,
      scriptUrl: "./sw.js",
      clock,
      reload: vi.fn(),
    });
    await flush();
    clock.advance(UPDATE_CHECK_INTERVAL_MS);
    updates.checkForUpdate();
    await flush();
    expect(container.registration.update).toHaveBeenCalledTimes(2);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("updateWaiting", () => {
  it("is true for a waiting worker on a controlled page", async () => {
    const { updates, notifications } = setup({ waiting: true });
    expect(updates.updateWaiting).toBe(false);
    await flush();
    expect(updates.updateWaiting).toBe(true);
    expect(notifications).toEqual([true]);
  });

  it("is false for a waiting worker on an uncontrolled page", async () => {
    const { updates, notifications } = setup({
      waiting: true,
      controlled: false,
    });
    await flush();
    expect(updates.updateWaiting).toBe(false);
    expect(notifications).toEqual([]);
  });

  it("becomes true when an installing worker reaches installed", async () => {
    const { updates, registration, notifications } = setup();
    await flush();
    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event("updatefound"));
    expect(updates.updateWaiting).toBe(false);
    registration.installing = null;
    registration.waiting = worker;
    worker.setState("installed");
    expect(updates.updateWaiting).toBe(true);
    worker.setState("activating");
    expect(notifications).toEqual([true]);
  });

  it("stays false for a first install", async () => {
    const { updates, registration, notifications } = setup({
      active: false,
      controlled: false,
    });
    await flush();
    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event("updatefound"));
    registration.installing = null;
    registration.waiting = worker;
    worker.setState("installed");
    expect(updates.updateWaiting).toBe(false);
    expect(notifications).toEqual([]);
  });

  it("stops notifying after unsubscribe", async () => {
    const { updates, registration } = setup();
    await flush();
    const listener = vi.fn();
    const unsubscribe = updates.subscribe(listener);
    unsubscribe();
    registration.waiting = new FakeWorker();
    registration.dispatchEvent(new Event("updatefound"));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("checkForUpdate", () => {
  it("is ignored before registration resolves", () => {
    const { registration, clock, updates } = setup();
    clock.advance(UPDATE_CHECK_INTERVAL_MS);
    updates.checkForUpdate();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it("is throttled to the interval and records each check", async () => {
    const { registration, clock, updates } = setup();
    await flush();
    expect(registration.update).toHaveBeenCalledTimes(1);

    clock.advance(UPDATE_CHECK_INTERVAL_MS - 1);
    updates.checkForUpdate();
    expect(registration.update).toHaveBeenCalledTimes(1);

    clock.advance(1);
    updates.checkForUpdate();
    expect(registration.update).toHaveBeenCalledTimes(2);

    clock.advance(UPDATE_CHECK_INTERVAL_MS - 1);
    updates.checkForUpdate();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it("counts a first install as a check", async () => {
    const { registration, clock, updates } = setup({ active: false });
    await flush();
    clock.advance(UPDATE_CHECK_INTERVAL_MS - 1);
    updates.checkForUpdate();
    expect(registration.update).not.toHaveBeenCalled();
    clock.advance(1);
    updates.checkForUpdate();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});

describe("skipWaiting", () => {
  it("posts the message to the waiting worker only", async () => {
    const { updates, registration } = setup({ waiting: true });
    await flush();
    const active = registration.active as FakeWorker;
    updates.skipWaiting();
    expect(registration.waiting?.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
    expect(active.postMessage).not.toHaveBeenCalled();
  });

  it("does nothing without a waiting worker", async () => {
    const { updates, registration } = setup();
    await flush();
    updates.skipWaiting();
    expect((registration.active as FakeWorker).postMessage).not.toHaveBeenCalled();
  });
});

describe("controllerchange", () => {
  it("is routed to an attached gate without reloading", async () => {
    const { updates, container, reload } = setup();
    await flush();
    const gate = { controllerChanged: vi.fn() };
    updates.attachGate(gate);
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(gate.controllerChanged).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads exactly once without a gate", async () => {
    const { container, reload } = setup();
    await flush();
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("falls back to reloading after the gate is detached", async () => {
    const { updates, container, reload } = setup();
    await flush();
    const gate = { controllerChanged: vi.fn() };
    const detach = updates.attachGate(gate);
    detach();
    container.dispatchEvent(new Event("controllerchange"));
    expect(gate.controllerChanged).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
