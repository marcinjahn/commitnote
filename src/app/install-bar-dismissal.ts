import type { StorageLike } from "../session/session-store";

export const INSTALL_BAR_DISMISSED_KEY = "commitnote.installBarDismissed";

function resolveStorage(
  storage: StorageLike | null | undefined,
): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readInstallBarDismissed(
  storage?: StorageLike | null,
): boolean {
  const resolved = resolveStorage(storage);
  if (!resolved) return false;
  try {
    return resolved.getItem(INSTALL_BAR_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeInstallBarDismissed(storage?: StorageLike | null): void {
  const resolved = resolveStorage(storage);
  if (!resolved) return;
  try {
    resolved.setItem(INSTALL_BAR_DISMISSED_KEY, "1");
  } catch {
    // The bar reappears next visit if the flag cannot be stored.
  }
}
