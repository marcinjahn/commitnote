import { describe, expect, it } from "vitest";
import type { StorageLike } from "../session/session-store";
import {
  SHARE_INVITE_DISMISSED_KEY,
  readShareInviteDismissed,
  writeShareInviteDismissed,
} from "./share-invite-dismissal";

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

describe("share invite dismissal", () => {
  it("is not dismissed by default", () => {
    expect(readShareInviteDismissed(new MemoryStorage())).toBe(false);
  });

  it("reads true after a write", () => {
    const storage = new MemoryStorage();
    writeShareInviteDismissed(storage);
    expect(readShareInviteDismissed(storage)).toBe(true);
  });

  it("stores the string 1 under the documented key", () => {
    const storage = new MemoryStorage();
    writeShareInviteDismissed(storage);
    expect(SHARE_INVITE_DISMISSED_KEY).toBe("commitnote.shareInviteDismissed");
    expect(storage.map.get("commitnote.shareInviteDismissed")).toBe("1");
  });

  it("reads false for any other stored value", () => {
    const storage = new MemoryStorage();
    storage.setItem(SHARE_INVITE_DISMISSED_KEY, "true");
    expect(readShareInviteDismissed(storage)).toBe(false);
  });

  it("reads false and does not throw when storage throws", () => {
    const storage = new ThrowingStorage();
    expect(readShareInviteDismissed(storage)).toBe(false);
    expect(() => writeShareInviteDismissed(storage)).not.toThrow();
  });

  it("reads false and writes nothing with disabled storage", () => {
    expect(readShareInviteDismissed(null)).toBe(false);
    expect(() => writeShareInviteDismissed(null)).not.toThrow();
  });
});
