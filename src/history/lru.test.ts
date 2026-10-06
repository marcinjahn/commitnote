import { describe, expect, it } from "vitest";
import { Lru } from "./lru";

describe("Lru", () => {
  it("evicts the oldest entry beyond capacity", () => {
    const lru = new Lru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("c")).toBe(3);
  });

  it("clear removes all entries", () => {
    const lru = new Lru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.clear();
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBeUndefined();
  });
});
