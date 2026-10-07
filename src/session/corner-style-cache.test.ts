import { describe, expect, it } from "vitest";
import {
  CORNER_STYLE_CACHE_KEY,
  readCachedCornerStyle,
  writeCachedCornerStyle,
} from "./corner-style-cache";
import type { StorageLike } from "./session-store";

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}

describe("corner-style cache", () => {
  it("uses the documented storage key", () => {
    expect(CORNER_STYLE_CACHE_KEY).toBe("commitnote.cornerStyle");
  });

  it.each(["rounded", "square"] as const)("roundtrips %s", (style) => {
    const storage = new MemoryStorage();
    writeCachedCornerStyle(style, storage);
    expect(storage.getItem(CORNER_STYLE_CACHE_KEY)).toBe(style);
    expect(readCachedCornerStyle(storage)).toBe(style);
  });

  it("returns null when nothing is cached", () => {
    expect(readCachedCornerStyle(new MemoryStorage())).toBeNull();
  });

  it("returns null for an invalid cached value", () => {
    const storage = new MemoryStorage();
    storage.setItem(CORNER_STYLE_CACHE_KEY, "pill");
    expect(readCachedCornerStyle(storage)).toBeNull();
  });

  it("never throws when storage throws", () => {
    const storage = new ThrowingStorage();
    expect(readCachedCornerStyle(storage)).toBeNull();
    expect(() => writeCachedCornerStyle("square", storage)).not.toThrow();
  });

  it("treats null storage as unavailable", () => {
    expect(readCachedCornerStyle(null)).toBeNull();
    expect(() => writeCachedCornerStyle("square", null)).not.toThrow();
  });
});
