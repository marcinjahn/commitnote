import type { SyncState } from "../sync/sync-state";
import { changedSettingKeys } from "./settings";
import type { RawSettings, SettingsEdits } from "./settings";

const WAITING: SyncState = { kind: "out-of-sync", reason: "pending" };

/**
 * Edits still held by the settings saver haven't reached the engine yet, so
 * they count as waiting to save unless the engine's last save failed.
 */
export function settingsSaveState(input: {
  readonly engine: SyncState;
  readonly stored: RawSettings;
  readonly heldEdits: SettingsEdits;
}): SyncState {
  const { engine, stored, heldEdits } = input;
  if (engine.kind === "out-of-sync" && engine.reason === "failed") return engine;
  if (changedSettingKeys(stored, heldEdits).length > 0) return WAITING;
  return engine;
}
