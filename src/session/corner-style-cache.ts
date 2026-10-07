import { parseCornerStyle, type CornerStyle } from "../settings/corner-style";
import type { StorageLike } from "./session-store";

export const CORNER_STYLE_CACHE_KEY = "commitnote.cornerStyle";

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

export function readCachedCornerStyle(
  storage?: StorageLike | null,
): CornerStyle | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    return parseCornerStyle(target.getItem(CORNER_STYLE_CACHE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function writeCachedCornerStyle(
  style: CornerStyle,
  storage?: StorageLike | null,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(CORNER_STYLE_CACHE_KEY, style);
  } catch {
    // An unavailable cache only costs the first-paint hint.
  }
}
