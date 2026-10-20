import { describe, expect, it, vi } from "vitest";
import type { HostServices } from "../host-services";
import { createTimers } from "./timers";

function fakeClock() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const clock = {
    now: () => 0,
    setTimeout: vi.fn((callback: () => void, _ms: number) => {
      const id = next++;
      pending.set(id, callback);
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      pending.delete(id);
    }),
  };
  const fire = (id: number) => pending.get(id)?.();
  return { host: { clock } as unknown as HostServices, clock, fire, pending };
}

describe("timers", () => {
  it("delegates setTimeout to the host clock and runs the callback", () => {
    const { host, clock, fire } = fakeClock();
    const timers = createTimers(() => host);
    const callback = vi.fn();
    const id = timers.setTimeout(callback, 250);
    expect(clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(callback).not.toHaveBeenCalled();
    fire(id);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith();
  });

  it("clears through the host clock", () => {
    const { host, clock, pending } = fakeClock();
    const timers = createTimers(() => host);
    const id = timers.setTimeout(() => {}, 10);
    timers.clearTimeout(id);
    expect(clock.clearTimeout).toHaveBeenCalledWith(id);
    expect(pending.size).toBe(0);
    timers.clearTimeout(undefined);
    expect(clock.clearTimeout).toHaveBeenCalledTimes(1);
  });

  it("defaults the delay to 0 and clamps invalid values", () => {
    const { host, clock } = fakeClock();
    const timers = createTimers(() => host);
    timers.setTimeout(() => {});
    timers.setTimeout(() => {}, -5);
    timers.setTimeout(() => {}, Number.NaN);
    expect(clock.setTimeout.mock.calls.map((call) => call[1])).toEqual([0, 0, 0]);
  });

  it("resolves the host only when called", () => {
    const getHost = vi.fn(() => fakeClock().host);
    const timers = createTimers(getHost);
    expect(getHost).not.toHaveBeenCalled();
    timers.setTimeout(() => {}, 1);
    expect(getHost).toHaveBeenCalledOnce();
  });

  it("rejects a non-function callback", () => {
    const timers = createTimers(() => fakeClock().host);
    expect(() => timers.setTimeout("x" as never, 1)).toThrow(TypeError);
  });

  it("queues microtasks after the current synchronous work", async () => {
    const timers = createTimers(() => fakeClock().host);
    const order: string[] = [];
    timers.queueMicrotask(() => order.push("micro"));
    order.push("sync");
    await Promise.resolve();
    expect(order).toEqual(["sync", "micro"]);
  });
});
