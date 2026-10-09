import { describe, expect, it, vi } from "vitest";
import { pullGesture, type PullGestureOptions } from "./pull-gesture";
import { PULL_THRESHOLDS, type PullState } from "./pull-to-refresh";

const ORIGIN = 100;
const ARMED_Y =
  ORIGIN +
  PULL_THRESHOLDS.slop +
  PULL_THRESHOLDS.arm / PULL_THRESHOLDS.resistance +
  20;

class FakeNode extends EventTarget {
  private captured = new Set<number>();
  readonly setPointerCapture = vi.fn((id: number) => {
    this.captured.add(id);
  });
  readonly releasePointerCapture = vi.fn((id: number) => {
    this.captured.delete(id);
  });
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }
}

type PointerInit = {
  readonly pointerType?: string;
  readonly isPrimary?: boolean;
  readonly pointerId?: number;
  readonly clientY?: number;
};

function pointer(type: string, init: PointerInit = {}): Event {
  return Object.assign(new Event(type), {
    pointerType: init.pointerType ?? "touch",
    isPrimary: init.isPrimary ?? true,
    pointerId: init.pointerId ?? 1,
    clientY: init.clientY ?? ORIGIN,
  });
}

function setup(overrides: Partial<PullGestureOptions> = {}) {
  const node = new FakeNode();
  const states: PullState[] = [];
  let resolveRefresh: () => void = () => {};
  const onRefresh = vi.fn(
    () => new Promise<void>((resolve) => (resolveRefresh = resolve)),
  );
  const options: PullGestureOptions = {
    enabled: true,
    onChange: (state) => states.push(state),
    onRefresh,
    ...overrides,
  };
  const action = pullGesture(node as unknown as HTMLElement, options);
  const send = (type: string, init?: PointerInit) =>
    node.dispatchEvent(pointer(type, init));
  return {
    node,
    states,
    onRefresh,
    action,
    options,
    send,
    resolveRefresh: () => resolveRefresh(),
    phase: () => states.at(-1)?.phase ?? "idle",
  };
}

describe("pullGesture", () => {
  it("ignores mouse pointers", () => {
    const g = setup();
    g.send("pointerdown", { pointerType: "mouse" });
    g.send("pointermove", { pointerType: "mouse", clientY: ARMED_Y });
    g.send("pointerup", { pointerType: "mouse" });

    expect(g.states).toEqual([]);
    expect(g.node.setPointerCapture).not.toHaveBeenCalled();
    expect(g.onRefresh).not.toHaveBeenCalled();
  });

  it("ignores everything while disabled", () => {
    const g = setup({ enabled: false });
    g.send("pointerdown");
    g.send("pointermove", { clientY: ARMED_Y });
    g.send("pointerup");

    expect(g.states).toEqual([]);
    expect(g.onRefresh).not.toHaveBeenCalled();
  });

  it("captures the pointer only after the slop", () => {
    const g = setup();
    g.send("pointerdown", { pointerId: 7 });
    g.send("pointermove", {
      pointerId: 7,
      clientY: ORIGIN + PULL_THRESHOLDS.slop,
    });
    expect(g.node.setPointerCapture).not.toHaveBeenCalled();

    g.send("pointermove", {
      pointerId: 7,
      clientY: ORIGIN + PULL_THRESHOLDS.slop + 2,
    });
    expect(g.node.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(g.phase()).toBe("pulling");

    g.send("pointermove", { pointerId: 7, clientY: ORIGIN + 60 });
    expect(g.node.setPointerCapture).toHaveBeenCalledOnce();
  });

  it("refreshes once on an armed release and returns to idle after it resolves", async () => {
    const g = setup();
    g.send("pointerdown");
    g.send("pointermove", { clientY: ARMED_Y });
    expect(g.phase()).toBe("armed");

    g.send("pointerup");
    expect(g.onRefresh).toHaveBeenCalledOnce();
    expect(g.phase()).toBe("refreshing");

    g.send("pointerdown");
    g.send("pointermove", { clientY: ARMED_Y });
    g.send("pointerup");
    expect(g.onRefresh).toHaveBeenCalledOnce();

    g.resolveRefresh();
    await vi.waitFor(() => expect(g.phase()).toBe("idle"));
    expect(g.onRefresh).toHaveBeenCalledOnce();
  });

  it("does not refresh on a short release", () => {
    const g = setup();
    g.send("pointerdown");
    g.send("pointermove", { clientY: ORIGIN + 40 });
    g.send("pointerup");

    expect(g.onRefresh).not.toHaveBeenCalled();
    expect(g.phase()).toBe("idle");
  });

  it("resets on pointercancel", () => {
    const g = setup();
    g.send("pointerdown");
    g.send("pointermove", { clientY: ARMED_Y });
    g.send("pointercancel");

    expect(g.phase()).toBe("idle");
    g.send("pointerup");
    expect(g.onRefresh).not.toHaveBeenCalled();
  });

  it("cancels when disabled mid-gesture", () => {
    const g = setup();
    g.send("pointerdown");
    g.send("pointermove", { clientY: ARMED_Y });

    g.action.update?.({ ...g.options, enabled: false });
    expect(g.phase()).toBe("idle");
    expect(g.node.releasePointerCapture).toHaveBeenCalledWith(1);

    g.send("pointerup");
    expect(g.onRefresh).not.toHaveBeenCalled();
  });
});
