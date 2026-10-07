import type { Change, ChangeSet, NotePath } from "../changes/change";
import { parentPath } from "../changes/change";
import { CONFLICT_MARKERS } from "../merge/merge-text";

type OutOfSyncReason = "pending" | "failed" | "conflict";

export type SyncState =
  | { readonly kind: "synced" }
  | { readonly kind: "syncing" }
  | { readonly kind: "out-of-sync"; readonly reason: OutOfSyncReason };

export interface SyncStates {
  stateOf(path: NotePath): SyncState;
  readonly unsavedCount: number;
  readonly hasUnsaved: boolean;
  readonly settings: SyncState;
}

export const SYNCED: SyncState = { kind: "synced" };
const SYNCING: SyncState = { kind: "syncing" };
const OUT_OF_SYNC_PENDING: SyncState = {
  kind: "out-of-sync",
  reason: "pending",
};
const OUT_OF_SYNC_FAILED: SyncState = { kind: "out-of-sync", reason: "failed" };
const OUT_OF_SYNC_CONFLICT: SyncState = {
  kind: "out-of-sync",
  reason: "conflict",
};

// Precedence, weakest to strongest: conflict > failed > pending > syncing > synced.
const LEVEL_SYNCED = 0;
const LEVEL_SYNCING = 1;
const LEVEL_PENDING = 2;
const LEVEL_FAILED = 3;
const LEVEL_CONFLICT = 4;

const STATE_BY_LEVEL: readonly SyncState[] = [
  SYNCED,
  SYNCING,
  OUT_OF_SYNC_PENDING,
  OUT_OF_SYNC_FAILED,
  OUT_OF_SYNC_CONFLICT,
];

// Purges are background housekeeping of already-deleted items, so they never
// count as unsaved work.
function entryPathOf(change: Change): NotePath | null {
  switch (change.kind) {
    case "create-note":
    case "update-note":
    case "create-folder":
    case "set-color-tag":
      return change.path;
    case "rename-note":
    case "rename-folder":
      return change.to;
    case "delete-note":
    case "delete-folder":
    case "trash-note":
    case "trash-folder":
      return parentPath(change.path);
    case "restore-trash":
      return change.to;
    case "set-order":
      return change.moved === undefined
        ? change.parent
        : [...change.parent, change.moved];
    case "add-share":
    case "update-share":
      return change.entry.note.state === "active" ? change.entry.note.path : null;
    case "purge-trash":
    case "set-settings":
    case "remove-share":
    case "set-share-label":
      return null;
  }
}

function keyOf(path: NotePath): string {
  return path.join("/");
}

export function computeSyncStates(input: {
  readonly pending: ChangeSet;
  readonly inFlight: ChangeSet;
  readonly failed: boolean;
  readonly conflicts: readonly NotePath[];
}): SyncStates {
  const { pending, inFlight, failed, conflicts } = input;

  const levelByKey = new Map<string, number>();
  const entryKeys = new Set<string>();
  const entryParentKeys = new Set<string>();
  const orderKeys = new Set<string>();

  function raise(path: NotePath, level: number): void {
    for (let depth = path.length; depth >= 0; depth--) {
      const key = keyOf(path.slice(0, depth));
      const current = levelByKey.get(key) ?? LEVEL_SYNCED;
      if (level > current) levelByKey.set(key, level);
    }
  }

  function applyChangeSet(changes: ChangeSet, level: number): void {
    for (const change of changes) {
      const path = entryPathOf(change);
      if (path === null) continue;
      if (change.kind === "set-order" && change.moved === undefined) {
        orderKeys.add(keyOf(path));
      } else {
        entryKeys.add(keyOf(path));
        if (path.length > 0) entryParentKeys.add(keyOf(parentPath(path)));
      }
      raise(path, level);
    }
  }

  applyChangeSet(inFlight, failed ? LEVEL_FAILED : LEVEL_SYNCING);
  applyChangeSet(pending, failed ? LEVEL_FAILED : LEVEL_PENDING);

  for (const conflictPath of conflicts) {
    entryKeys.add(keyOf(conflictPath));
    if (conflictPath.length > 0) {
      entryParentKeys.add(keyOf(parentPath(conflictPath)));
    }
    raise(conflictPath, LEVEL_CONFLICT);
  }

  // Positions with no moved item, like those of a new item, count on their
  // own only when nothing else in their folder is unsaved.
  let unsavedCount = entryKeys.size;
  for (const key of orderKeys) {
    if (!entryKeys.has(key) && !entryParentKeys.has(key)) unsavedCount++;
  }
  const hasSettings = (changes: ChangeSet) =>
    changes.some((change) => change.kind === "set-settings");
  const settingsPending = hasSettings(pending);
  const settingsInFlight = hasSettings(inFlight);
  if (settingsInFlight || settingsPending) unsavedCount++;
  const settingsLevel = !settingsPending && !settingsInFlight
    ? LEVEL_SYNCED
    : failed
      ? LEVEL_FAILED
      : settingsPending
        ? LEVEL_PENDING
        : LEVEL_SYNCING;

  function stateOf(path: NotePath): SyncState {
    const level = levelByKey.get(keyOf(path)) ?? LEVEL_SYNCED;
    return STATE_BY_LEVEL[level];
  }

  return {
    stateOf,
    unsavedCount,
    hasUnsaved: unsavedCount > 0,
    settings: STATE_BY_LEVEL[settingsLevel],
  };
}

export function removeConflictMarkerLines(text: string): string {
  const markers: readonly string[] = Object.values(CONFLICT_MARKERS);
  return text
    .split("\n")
    .filter((rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      return !markers.includes(line);
    })
    .join("\n");
}

export function hasConflictMarkers(text: string): boolean {
  const markers: readonly string[] = Object.values(CONFLICT_MARKERS);
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (markers.includes(line)) return true;
  }
  return false;
}
