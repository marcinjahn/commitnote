import type { StorageLike } from "../../session/session-store";

export const SIDEBAR_WIDTH_KEY = "commitnote.sidebarWidth";
export const SIDEBAR_MIN_WIDTH = 300;
export const SIDEBAR_MAX_WIDTH = 640;
export const NOTE_PANE_MIN_WIDTH = 400;
export const SIDEBAR_WIDTH_STEP = 16;

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

export function clampPreferredWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_MIN_WIDTH;
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export function effectiveSidebarMinWidth(rendered: number): number {
  return Number.isFinite(rendered)
    ? Math.max(SIDEBAR_MIN_WIDTH, rendered)
    : SIDEBAR_MIN_WIDTH;
}

export function maxSidebarWidth(
  viewportWidth: number,
  minWidth: number = SIDEBAR_MIN_WIDTH,
): number {
  return Math.max(
    minWidth,
    Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - NOTE_PANE_MIN_WIDTH),
  );
}

export function shownSidebarWidth(
  preferred: number,
  viewportWidth: number,
  minWidth: number = SIDEBAR_MIN_WIDTH,
): number {
  return Math.min(
    maxSidebarWidth(viewportWidth, minWidth),
    Math.max(minWidth, preferred),
  );
}

export function readSidebarWidth(storage?: StorageLike | null): number {
  const target = resolveStorage(storage);
  if (!target) return SIDEBAR_MIN_WIDTH;
  try {
    const raw = target.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null || raw.trim() === "") return SIDEBAR_MIN_WIDTH;
    return clampPreferredWidth(Number(raw));
  } catch {
    return SIDEBAR_MIN_WIDTH;
  }
}

export function writeSidebarWidth(
  width: number,
  storage?: StorageLike | null,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(SIDEBAR_WIDTH_KEY, String(clampPreferredWidth(width)));
  } catch {
    // An unavailable store only loses the remembered width.
  }
}

export function clearSidebarWidth(storage?: StorageLike | null): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(SIDEBAR_WIDTH_KEY);
  } catch {
    // An unavailable store only loses the remembered width.
  }
}
