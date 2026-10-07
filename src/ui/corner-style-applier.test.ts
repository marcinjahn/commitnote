import { describe, expect, it, vi } from "vitest";
import { CORNER_STYLE_CACHE_KEY } from "../session/corner-style-cache";
import type { StorageLike } from "../session/session-store";
import {
  createCornerStyleApplier,
  setCornerStyleAttribute,
} from "./corner-style-applier";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();

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

function makeRoot(bootCorners?: string) {
  const root = { dataset: {} as DOMStringMap };
  if (bootCorners) root.dataset.corners = bootCorners;
  return root;
}

describe("setCornerStyleAttribute", () => {
  it("sets data-corners to square", () => {
    const root = makeRoot();
    setCornerStyleAttribute(root, "square");
    expect(root.dataset.corners).toBe("square");
  });

  it("removes data-corners for rounded", () => {
    const root = makeRoot("square");
    setCornerStyleAttribute(root, "rounded");
    expect(root.dataset.corners).toBeUndefined();
    expect("corners" in root.dataset).toBe(false);
  });
});

describe("corner-style applier", () => {
  it("writes the square and rounded attribute", () => {
    const root = makeRoot();
    const applier = createCornerStyleApplier(root, {
      storage: new MemoryStorage(),
    });

    applier.applyCornerStyle("square");
    expect(root.dataset.corners).toBe("square");

    applier.applyCornerStyle("rounded");
    expect(root.dataset.corners).toBeUndefined();
  });

  it("writes the cache on the first application and on change only", () => {
    const storage = new MemoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const applier = createCornerStyleApplier(makeRoot(), { storage });

    applier.applyCornerStyle("rounded");
    applier.applyCornerStyle("rounded");
    applier.applyCornerStyle("square");
    applier.applyCornerStyle("square");

    expect(setItem.mock.calls).toEqual([
      [CORNER_STYLE_CACHE_KEY, "rounded"],
      [CORNER_STYLE_CACHE_KEY, "square"],
    ]);
  });

  it("pins square under an override and never writes the cache", () => {
    const root = makeRoot();
    const storage = new MemoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const applier = createCornerStyleApplier(root, {
      storage,
      override: "square",
    });
    expect(root.dataset.corners).toBe("square");

    applier.applyCornerStyle("rounded");

    expect(root.dataset.corners).toBe("square");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("removes a pre-set attribute under a rounded override and pins it", () => {
    const root = makeRoot("square");
    const storage = new MemoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const applier = createCornerStyleApplier(root, {
      storage,
      override: "rounded",
    });
    expect(root.dataset.corners).toBeUndefined();

    applier.applyCornerStyle("square");

    expect(root.dataset.corners).toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("tolerates unavailable storage", () => {
    for (const storage of [new ThrowingStorage(), null]) {
      const root = makeRoot();
      const applier = createCornerStyleApplier(root, { storage });

      expect(() => applier.applyCornerStyle("square")).not.toThrow();
      expect(root.dataset.corners).toBe("square");
    }
  });
});
