import { describe, expect, it } from "vitest";
import {
  COLOR_MODE_CACHE_KEY,
  readCachedColorMode,
  writeCachedColorMode,
} from "./color-mode-cache";
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

describe("color-mode cache", () => {
  it.each(["system", "light", "dark"] as const)("roundtrips %s", (mode) => {
    const storage = new MemoryStorage();
    writeCachedColorMode(mode, storage);
    expect(storage.getItem(COLOR_MODE_CACHE_KEY)).toBe(mode);
    expect(readCachedColorMode(storage)).toBe(mode);
  });

  it("returns null when nothing is cached", () => {
    expect(readCachedColorMode(new MemoryStorage())).toBeNull();
  });

  it("returns null for an invalid cached value", () => {
    const storage = new MemoryStorage();
    storage.setItem(COLOR_MODE_CACHE_KEY, "sepia");
    expect(readCachedColorMode(storage)).toBeNull();
  });

  it("never throws when storage throws", () => {
    const storage = new ThrowingStorage();
    expect(readCachedColorMode(storage)).toBeNull();
    expect(() => writeCachedColorMode("dark", storage)).not.toThrow();
  });

  it("treats null storage as unavailable", () => {
    expect(readCachedColorMode(null)).toBeNull();
    expect(() => writeCachedColorMode("dark", null)).not.toThrow();
  });
});
