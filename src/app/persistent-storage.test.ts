import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "./persistent-storage";

function storage(persisted: boolean) {
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => true),
  };
}

describe("requestPersistentStorage", () => {
  it("does nothing without a storage manager", async () => {
    await expect(requestPersistentStorage(undefined)).resolves.toBeUndefined();
  });

  it("does nothing when persist is missing", async () => {
    const manager = { persisted: vi.fn(async () => false) };
    await requestPersistentStorage(manager as unknown as StorageManager);
    expect(manager.persisted).not.toHaveBeenCalled();
  });

  it("skips persist when storage is already persisted", async () => {
    const manager = storage(true);
    await requestPersistentStorage(manager);
    expect(manager.persist).not.toHaveBeenCalled();
  });

  it("asks for persistence otherwise", async () => {
    const manager = storage(false);
    await requestPersistentStorage(manager);
    expect(manager.persist).toHaveBeenCalledTimes(1);
  });

  it("swallows a persist rejection", async () => {
    const manager = storage(false);
    manager.persist.mockRejectedValue(new Error("denied"));
    await expect(requestPersistentStorage(manager)).resolves.toBeUndefined();
  });

  it("swallows a persisted rejection", async () => {
    const manager = storage(false);
    manager.persisted.mockRejectedValue(new Error("broken"));
    await expect(requestPersistentStorage(manager)).resolves.toBeUndefined();
  });
});
