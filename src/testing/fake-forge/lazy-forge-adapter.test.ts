import { describe, expect, it, vi } from "vitest";
import { FakeForgeAdapter } from "../../forge/fake/fake-forge-adapter";
import { createLazyForgeAdapter } from "./lazy-forge-adapter";

describe("createLazyForgeAdapter", () => {
  it("does not create the adapter before the first call", () => {
    const create = vi.fn(() => Promise.resolve(new FakeForgeAdapter()));
    createLazyForgeAdapter(create);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the adapter once across several calls", async () => {
    const create = vi.fn(() => Promise.resolve(new FakeForgeAdapter()));
    const lazy = createLazyForgeAdapter(create);

    await Promise.all([lazy.inspect(), lazy.inspect()]);
    await lazy.inspect();

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("delegates to the created adapter", async () => {
    const lazy = createLazyForgeAdapter(() =>
      Promise.resolve(new FakeForgeAdapter({ canWrite: false })),
    );
    expect(await lazy.inspect()).toEqual({ kind: "empty", canWrite: false });
  });
});
