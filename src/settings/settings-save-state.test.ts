import { describe, expect, it } from "vitest";
import type { SyncState } from "../sync/sync-state";
import { settingsSaveState } from "./settings-save-state";

const SYNCED: SyncState = { kind: "synced" };
const SYNCING: SyncState = { kind: "syncing" };
const WAITING: SyncState = { kind: "out-of-sync", reason: "pending" };
const FAILED: SyncState = { kind: "out-of-sync", reason: "failed" };

describe("settingsSaveState", () => {
  it("is the engine state when the saver holds no edits", () => {
    expect(
      settingsSaveState({ engine: SYNCING, stored: {}, heldEdits: {} }),
    ).toEqual(SYNCING);
  });

  it("is waiting while the saver holds an edit that changes a setting", () => {
    expect(
      settingsSaveState({
        engine: SYNCED,
        stored: { accentColor: "blue" },
        heldEdits: { accentColor: "teal" },
      }),
    ).toEqual(WAITING);
  });

  it("is waiting while a held edit follows one already being saved", () => {
    expect(
      settingsSaveState({
        engine: SYNCING,
        stored: { accentColor: "blue" },
        heldEdits: { accentColor: "teal" },
      }),
    ).toEqual(WAITING);
  });

  it("ignores held edits that match the stored values", () => {
    expect(
      settingsSaveState({
        engine: SYNCED,
        stored: { accentColor: "teal" },
        heldEdits: { accentColor: "teal" },
      }),
    ).toEqual(SYNCED);
  });

  it("stays failed while edits are held", () => {
    expect(
      settingsSaveState({
        engine: FAILED,
        stored: {},
        heldEdits: { accentColor: "teal" },
      }),
    ).toEqual(FAILED);
  });
});
