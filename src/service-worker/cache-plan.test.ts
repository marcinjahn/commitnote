import { describe, expect, it } from "vitest";
import {
  SHELL_CACHE_PREFIX,
  SW_STATE_CACHE,
  lookupOrder,
  planActivation,
  shellCacheName,
} from "./cache-plan";

describe("shellCacheName", () => {
  it("prefixes the build id", () => {
    expect(shellCacheName("abc")).toBe("commitnote-shell-abc");
    expect(shellCacheName("abc").startsWith(SHELL_CACHE_PREFIX)).toBe(true);
  });
});

describe("planActivation", () => {
  it("keeps the current and previous caches and removes older ones", () => {
    const names = ["b1", "b2", "b3", "b4"].map(shellCacheName);
    expect(planActivation(names, "b4", "b3")).toEqual({
      keep: [shellCacheName("b3"), shellCacheName("b4")],
      remove: [shellCacheName("b1"), shellCacheName("b2")],
    });
  });

  it("removes an orphaned cache from a build that never activated", () => {
    const names = ["b1", "b2", "orphan"].map(shellCacheName);
    expect(planActivation(names, "b2", "b1")).toEqual({
      keep: [shellCacheName("b1"), shellCacheName("b2")],
      remove: [shellCacheName("orphan")],
    });
  });

  it("keeps only the current cache without a previous build", () => {
    const names = ["b1", "b2"].map(shellCacheName);
    expect(planActivation(names, "b2", null)).toEqual({
      keep: [shellCacheName("b2")],
      remove: [shellCacheName("b1")],
    });
  });

  it("does not treat the current build as the previous one", () => {
    const names = ["b1", "b2"].map(shellCacheName);
    expect(planActivation(names, "b2", "b2")).toEqual({
      keep: [shellCacheName("b2")],
      remove: [shellCacheName("b1")],
    });
  });

  it("ignores a previous build whose cache is missing", () => {
    const names = ["b2"].map(shellCacheName);
    expect(planActivation(names, "b2", "b1")).toEqual({
      keep: [shellCacheName("b2")],
      remove: [],
    });
  });

  it("never touches caches without the shell prefix", () => {
    const names = [
      "other-cache",
      SW_STATE_CACHE,
      shellCacheName("b1"),
      shellCacheName("b2"),
    ];
    const plan = planActivation(names, "b2", null);
    expect(plan.remove).toEqual([shellCacheName("b1")]);
    expect(plan.keep).not.toContain("other-cache");
    expect(plan.keep).not.toContain(SW_STATE_CACHE);
  });
});

describe("lookupOrder", () => {
  it("puts the current cache first even when it was created last", () => {
    const names = [shellCacheName("old"), "other", shellCacheName("new")];
    expect(lookupOrder(names, "new")).toEqual([
      shellCacheName("new"),
      shellCacheName("old"),
    ]);
  });

  it("keeps the remaining order and skips a missing current cache", () => {
    const names = ["a", "b", "c"].map(shellCacheName);
    expect(lookupOrder(names, "b")).toEqual(
      ["b", "a", "c"].map(shellCacheName),
    );
    expect(lookupOrder(names, "zzz")).toEqual(names);
  });
});
