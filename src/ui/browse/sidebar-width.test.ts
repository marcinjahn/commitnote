import { describe, expect, it } from "vitest";
import type { StorageLike } from "../../session/session-store";
import {
  SIDEBAR_WIDTH_KEY,
  clampPreferredWidth,
  clearSidebarWidth,
  maxSidebarWidth,
  readSidebarWidth,
  shownSidebarWidth,
  writeSidebarWidth,
} from "./sidebar-width";

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

describe("clampPreferredWidth", () => {
  it.each([
    [100, 300],
    [300, 300],
    [450, 450],
    [640, 640],
    [900, 640],
    [450.4, 450],
    [450.6, 451],
    [Number.NaN, 300],
    [Number.POSITIVE_INFINITY, 300],
    [Number.NEGATIVE_INFINITY, 300],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampPreferredWidth(input)).toBe(expected);
  });
});

describe("maxSidebarWidth", () => {
  it.each([
    [2000, 640],
    [1040, 640],
    [1000, 600],
    [768, 368],
    [700, 300],
    [500, 300],
  ])("viewport %s allows %s", (viewport, expected) => {
    expect(maxSidebarWidth(viewport)).toBe(expected);
  });
});

describe("shownSidebarWidth", () => {
  it("keeps the preferred width on a wide viewport", () => {
    expect(shownSidebarWidth(640, 2000)).toBe(640);
  });

  it("caps the width on a narrower viewport", () => {
    expect(shownSidebarWidth(640, 1000)).toBe(600);
    expect(shownSidebarWidth(640, 768)).toBe(368);
  });

  it("never goes below the minimum", () => {
    expect(shownSidebarWidth(640, 700)).toBe(300);
    expect(shownSidebarWidth(640, 500)).toBe(300);
    expect(shownSidebarWidth(200, 2000)).toBe(300);
  });
});

describe("sidebar width storage", () => {
  it("roundtrips a stored width", () => {
    const storage = new MemoryStorage();
    writeSidebarWidth(480, storage);
    expect(storage.getItem(SIDEBAR_WIDTH_KEY)).toBe("480");
    expect(readSidebarWidth(storage)).toBe(480);
  });

  it("stores the clamped preferred width", () => {
    const storage = new MemoryStorage();
    writeSidebarWidth(900, storage);
    expect(storage.getItem(SIDEBAR_WIDTH_KEY)).toBe("640");
    writeSidebarWidth(120.4, storage);
    expect(storage.getItem(SIDEBAR_WIDTH_KEY)).toBe("300");
    writeSidebarWidth(400.6, storage);
    expect(storage.getItem(SIDEBAR_WIDTH_KEY)).toBe("401");
  });

  it("defaults when nothing is stored", () => {
    expect(readSidebarWidth(new MemoryStorage())).toBe(300);
  });

  it.each(["", "  ", "wide", "NaN", "Infinity"])(
    "defaults for invalid stored value %j",
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem(SIDEBAR_WIDTH_KEY, raw);
      expect(readSidebarWidth(storage)).toBe(300);
    },
  );

  it("reads out-of-range values back clamped", () => {
    const storage = new MemoryStorage();
    storage.setItem(SIDEBAR_WIDTH_KEY, "5000");
    expect(readSidebarWidth(storage)).toBe(640);
    storage.setItem(SIDEBAR_WIDTH_KEY, "10");
    expect(readSidebarWidth(storage)).toBe(300);
  });

  it("clears the stored width", () => {
    const storage = new MemoryStorage();
    writeSidebarWidth(500, storage);
    clearSidebarWidth(storage);
    expect(storage.getItem(SIDEBAR_WIDTH_KEY)).toBeNull();
    expect(readSidebarWidth(storage)).toBe(300);
  });

  it("tolerates throwing storage", () => {
    const storage = new ThrowingStorage();
    expect(readSidebarWidth(storage)).toBe(300);
    expect(() => writeSidebarWidth(500, storage)).not.toThrow();
    expect(() => clearSidebarWidth(storage)).not.toThrow();
  });

  it("tolerates missing storage", () => {
    expect(readSidebarWidth(null)).toBe(300);
    expect(() => writeSidebarWidth(500, null)).not.toThrow();
    expect(() => clearSidebarWidth(null)).not.toThrow();
  });
});
