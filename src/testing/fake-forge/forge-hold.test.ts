import { describe, expect, it } from "vitest";
import { ForgeError } from "../../forge/errors";
import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import { createForgeHolds } from "./forge-hold";

function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  const result = promise.finally(() => {
    state.settled = true;
  });
  return { state, result };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createForgeHolds", () => {
  it("keeps a held call pending until it is released", async () => {
    const holds = createForgeHolds();
    const adapter = holds.wrap("a/b", new FakeForgeAdapter());
    holds.hold("a/b", "inspect");

    const call = track(adapter.inspect());
    await flush();
    expect(call.state.settled).toBe(false);

    holds.release("a/b", "inspect");
    expect(await call.result).toEqual({ kind: "empty", canWrite: true });
  });

  it("runs calls made after release immediately", async () => {
    const holds = createForgeHolds();
    const adapter = holds.wrap("a/b", new FakeForgeAdapter());
    holds.hold("a/b", "inspect");
    const first = adapter.inspect();
    holds.release("a/b", "inspect");
    await first;

    expect(await adapter.inspect()).toEqual({ kind: "empty", canWrite: true });
  });

  it("resumes every waiting call in call order", async () => {
    const holds = createForgeHolds();
    const adapter = holds.wrap("a/b", new FakeForgeAdapter());
    holds.hold("a/b", "inspect");
    const order: number[] = [];
    const calls = [1, 2, 3].map((n) =>
      adapter.inspect().then(() => order.push(n)),
    );

    holds.release("a/b", "inspect");
    await Promise.all(calls);

    expect(order).toEqual([1, 2, 3]);
  });

  it("applies a failure registered before release to the released call", async () => {
    const holds = createForgeHolds();
    const fake = new FakeForgeAdapter();
    const adapter = holds.wrap("a/b", fake);
    holds.hold("a/b", "inspect");
    const call = adapter.inspect();
    const outcome = call.then(
      () => "resolved",
      (error: unknown) => (error instanceof ForgeError ? error.kind : "other"),
    );

    fake.failNext("inspect", new ForgeError("Network"));
    holds.release("a/b", "inspect");

    expect(await outcome).toBe("Network");
  });

  it("leaves other operations and repositories unaffected", async () => {
    const holds = createForgeHolds();
    const held = holds.wrap("a/b", new FakeForgeAdapter());
    const other = holds.wrap("c/d", new FakeForgeAdapter());
    holds.hold("a/b", "inspect");

    expect(await other.inspect()).toEqual({ kind: "empty", canWrite: true });
    const call = track(held.inspect());
    await expect(held.getHead()).rejects.toBeInstanceOf(Error);
    await flush();
    expect(call.state.settled).toBe(false);

    holds.release("a/b", "inspect");
    await call.result;
  });

  it("ignores hold of a held operation and release of a free one", async () => {
    const holds = createForgeHolds();
    const adapter = holds.wrap("a/b", new FakeForgeAdapter());
    holds.release("a/b", "inspect");
    holds.hold("a/b", "inspect");
    holds.hold("a/b", "inspect");
    const call = adapter.inspect();
    holds.release("a/b", "inspect");

    expect(await call).toEqual({ kind: "empty", canWrite: true });
  });
});
