import { describe, expect, it } from "vitest";
import {
  ALL_CHANGES_SAVED,
  INITIAL_ANNOUNCER_STATE,
  nextAnnouncement,
  syncProblem,
  type AnnouncerState,
  type SyncProblem,
} from "./status-announcer";

function step(
  state: AnnouncerState,
  problem: SyncProblem,
  allSaved: boolean,
  hasUnsaved = !allSaved,
) {
  return nextAnnouncement(state, { problem, allSaved, hasUnsaved });
}

describe("syncProblem", () => {
  const idle = { kind: "idle" } as const;
  const synced = { kind: "synced" } as const;

  it("is offline whenever the browser is offline", () => {
    expect(syncProblem({ online: false, root: synced, save: idle })).toBe("offline");
  });

  it("is failed for a failed root state", () => {
    const root = { kind: "out-of-sync", reason: "failed" } as const;
    expect(syncProblem({ online: true, root, save: idle })).toBe("failed");
  });

  it("is failed for a failed save", () => {
    const save = { kind: "waiting", reason: "failed", retryAt: null, error: null } as const;
    expect(syncProblem({ online: true, root: synced, save })).toBe("failed");
  });

  it("ignores pending, conflict and rate-limit waits", () => {
    const save = { kind: "waiting", reason: "rateBudget", retryAt: null, error: null } as const;
    const root = { kind: "out-of-sync", reason: "pending" } as const;
    expect(syncProblem({ online: true, root, save })).toBeNull();
  });
});

describe("nextAnnouncement", () => {
  it("announces going offline", () => {
    const result = step(INITIAL_ANNOUNCER_STATE, "offline", true, false);
    expect(result.message).toBe("Offline");
    expect(result.state).toEqual({ problem: "offline", awaitingRecovery: true });
  });

  it("announces offline with unsaved changes", () => {
    const result = step(INITIAL_ANNOUNCER_STATE, "offline", false, true);
    expect(result.message).toBe(
      "Offline. Changes will save when you're back online. Keep this tab open.",
    );
  });

  it("announces a failed save", () => {
    const result = step(INITIAL_ANNOUNCER_STATE, "failed", false);
    expect(result.message).toBe("Out of sync: saving failed, will retry");
    expect(result.state.awaitingRecovery).toBe(true);
  });

  it("announces when offline turns into failed", () => {
    const offline = step(INITIAL_ANNOUNCER_STATE, "offline", false).state;
    expect(step(offline, "failed", false).message).toBe(
      "Out of sync: saving failed, will retry",
    );
  });

  it("does not repeat an unchanged problem", () => {
    const first = step(INITIAL_ANNOUNCER_STATE, "failed", false).state;
    const second = step(first, "failed", false);
    expect(second.message).toBeNull();
    expect(second.state).toEqual(first);
  });

  it("announces recovery only once everything is saved", () => {
    const failed = step(INITIAL_ANNOUNCER_STATE, "failed", false).state;
    const saving = step(failed, null, false);
    expect(saving.message).toBeNull();
    expect(saving.state.awaitingRecovery).toBe(true);
    const saved = step(saving.state, null, true);
    expect(saved.message).toBe(ALL_CHANGES_SAVED);
    expect(saved.state).toEqual(INITIAL_ANNOUNCER_STATE);
  });

  it("announces recovery once", () => {
    const failed = step(INITIAL_ANNOUNCER_STATE, "failed", false).state;
    const saved = step(failed, null, true).state;
    expect(step(saved, null, true).message).toBeNull();
  });

  it("announces a problem that returns while waiting for recovery", () => {
    const failed = step(INITIAL_ANNOUNCER_STATE, "failed", false).state;
    const saving = step(failed, null, false).state;
    expect(step(saving, "failed", false).message).toBe(
      "Out of sync: saving failed, will retry",
    );
  });

  it("stays silent through ordinary save cycles", () => {
    let state = INITIAL_ANNOUNCER_STATE;
    for (const allSaved of [true, false, false, true]) {
      const result = step(state, null, allSaved);
      expect(result.message).toBeNull();
      state = result.state;
    }
    expect(state).toEqual(INITIAL_ANNOUNCER_STATE);
  });
});
