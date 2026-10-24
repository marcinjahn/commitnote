import type { HostDeviceSettingsStorage } from "./host-services";

export const REOPEN_LAST_VIEW_OFF_KEY = "commitnote.reopenLastViewOff";

export function isReopenLastViewOff(
  storage: HostDeviceSettingsStorage,
): boolean {
  try {
    return storage.getItem(REOPEN_LAST_VIEW_OFF_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeReopenLastViewOff(
  off: boolean,
  storage: HostDeviceSettingsStorage,
): void {
  try {
    if (off) storage.setItem(REOPEN_LAST_VIEW_OFF_KEY, "1");
    else storage.removeItem(REOPEN_LAST_VIEW_OFF_KEY);
  } catch {
    // Unavailable storage leaves the default, reopening the last view.
  }
}
