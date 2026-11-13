import type { StorageLike } from "../session/session-store";

export const SHARE_INVITE_DISMISSED_KEY = "commitnote.shareInviteDismissed";

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

export function readShareInviteDismissed(
  storage?: StorageLike | null,
): boolean {
  const resolved = resolveStorage(storage);
  if (!resolved) return false;
  try {
    return resolved.getItem(SHARE_INVITE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShareInviteDismissed(storage?: StorageLike | null): void {
  const resolved = resolveStorage(storage);
  if (!resolved) return;
  try {
    resolved.setItem(SHARE_INVITE_DISMISSED_KEY, "1");
  } catch {
    // The share invite comes back on the next share link when the flag cannot be stored.
  }
}
