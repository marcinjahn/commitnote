import { describe, expect, it } from "vitest";
import { createNoteContentCache, NOTE_CONTENT_CACHE_SIZE } from "./note-content-cache";

describe("note content cache", () => {
  it("returns stored content and undefined on a miss", () => {
    const cache = createNoteContentCache();
    cache.set("a", "text");
    expect(cache.get("a")).toBe("text");
    expect(cache.get("b")).toBeUndefined();
  });

  it("evicts the least recently used entry beyond capacity", () => {
    const cache = createNoteContentCache();
    for (let i = 0; i < NOTE_CONTENT_CACHE_SIZE; i++) cache.set(`k${i}`, `v${i}`);
    cache.get("k0");
    cache.set("extra", "x");
    expect(cache.get("k0")).toBe("v0");
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("extra")).toBe("x");
  });

  it("clears everything", () => {
    const cache = createNoteContentCache();
    cache.set("a", "text");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});
