import { describe, expect, it } from "vitest";
import type { StorageLike } from "../session/session-store";
import {
  INSTALL_BAR_DISMISSED_KEY,
  readInstallBarDismissed,
  writeInstallBarDismissed,
} from "./install-bar-dismissal";

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

describe("install bar dismissal", () => {
  it("is not dismissed by default", () => {
    expect(readInstallBarDismissed(new MemoryStorage())).toBe(false);
  });

  it("reads true after a write", () => {
    const storage = new MemoryStorage();
    writeInstallBarDismissed(storage);
    expect(readInstallBarDismissed(storage)).toBe(true);
  });

  it("stores the string 1 under the documented key", () => {
    const storage = new MemoryStorage();
    writeInstallBarDismissed(storage);
    expect(INSTALL_BAR_DISMISSED_KEY).toBe("commitnote.installBarDismissed");
    expect(storage.map.get("commitnote.installBarDismissed")).toBe("1");
  });

  it("reads false for any other stored value", () => {
    const storage = new MemoryStorage();
    storage.setItem(INSTALL_BAR_DISMISSED_KEY, "true");
    expect(readInstallBarDismissed(storage)).toBe(false);
  });

  it("reads false and does not throw when storage throws", () => {
    const storage = new ThrowingStorage();
    expect(readInstallBarDismissed(storage)).toBe(false);
    expect(() => writeInstallBarDismissed(storage)).not.toThrow();
  });

  it("reads false and writes nothing with disabled storage", () => {
    expect(readInstallBarDismissed(null)).toBe(false);
    expect(() => writeInstallBarDismissed(null)).not.toThrow();
  });
});
