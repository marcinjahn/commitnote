import { parseColorMode, type ColorModeId } from "../settings/color-mode";
import type { StorageLike } from "./session-store";

export const COLOR_MODE_CACHE_KEY = "commitnote.colorMode";

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

export function readCachedColorMode(
  storage?: StorageLike | null,
): ColorModeId | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    return parseColorMode(target.getItem(COLOR_MODE_CACHE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function writeCachedColorMode(
  mode: ColorModeId,
  storage?: StorageLike | null,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(COLOR_MODE_CACHE_KEY, mode);
  } catch {
    // An unavailable cache only costs the first-paint hint.
  }
}
