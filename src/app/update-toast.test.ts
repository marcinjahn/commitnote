import { describe, expect, it } from "vitest";
import { updateToastKind } from "./update-toast";

describe("updateToastKind", () => {
  it("offers the update only while one is waiting and the gate is idle", () => {
    expect(updateToastKind(true, "idle")).toBe("available");
    expect(updateToastKind(false, "idle")).toBeNull();
  });

  it("follows the gate while it waits for a save or a reload", () => {
    expect(updateToastKind(true, "waitingForSave")).toBe("waitingForSave");
    expect(updateToastKind(false, "reloadPending")).toBe("reloadPending");
  });

  it("shows nothing while the update activates or the page reloads", () => {
    expect(updateToastKind(true, "activating")).toBeNull();
    expect(updateToastKind(true, "reloading")).toBeNull();
  });
});
