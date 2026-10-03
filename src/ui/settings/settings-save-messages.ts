import type { SyncState } from "../../sync/sync-state";

export function describeSettingsSaveState(state: SyncState): string {
  switch (state.kind) {
    case "synced":
      return "Saved";
    case "syncing":
      return "Saving";
    case "out-of-sync":
      return state.reason === "pending" ? "Waiting to save" : "Saving failed";
  }
}

export function describeSettingsSaveStateInDetail(state: SyncState): string {
  switch (state.kind) {
    case "synced":
      return "Settings saved";
    case "syncing":
      return "Saving settings";
    case "out-of-sync":
      return state.reason === "pending"
        ? "Settings waiting to save"
        : "Saving settings failed, will retry";
  }
}
