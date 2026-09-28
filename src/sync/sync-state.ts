import type { Change, ChangeSet, NotePath } from "../changes/change";
import { parentPath } from "../changes/change";
import { CONFLICT_MARKERS } from "../merge/merge-text";

export type OutOfSyncReason = "pending" | "failed" | "conflict";

export type SyncState =
  | { readonly kind: "synced" }
  | { readonly kind: "syncing" }
  | { readonly kind: "out-of-sync"; readonly reason: OutOfSyncReason };

export interface SyncStates {
  stateOf(path: NotePath): SyncState;
  readonly unsavedCount: number;
  readonly hasUnsaved: boolean;
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

function entryPathOf(change: Change): NotePath {
  switch (change.kind) {
    case "create-note":
    case "update-note":
    case "create-folder":
      return change.path;
    case "rename-note":
    case "rename-folder":
      return change.to;
    case "delete-note":
    case "delete-folder":
      return parentPath(change.path);
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
      entryKeys.add(keyOf(path));
      raise(path, level);
    }
  }

  applyChangeSet(inFlight, failed ? LEVEL_FAILED : LEVEL_SYNCING);
  applyChangeSet(pending, failed ? LEVEL_FAILED : LEVEL_PENDING);

  for (const conflictPath of conflicts) {
    entryKeys.add(keyOf(conflictPath));
    raise(conflictPath, LEVEL_CONFLICT);
  }

  function stateOf(path: NotePath): SyncState {
    const level = levelByKey.get(keyOf(path)) ?? LEVEL_SYNCED;
    return STATE_BY_LEVEL[level];
  }

  return {
    stateOf,
    unsavedCount: entryKeys.size,
    hasUnsaved: entryKeys.size > 0,
  };
}

export function hasConflictMarkers(text: string): boolean {
  const markers: readonly string[] = Object.values(CONFLICT_MARKERS);
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (markers.includes(line)) return true;
  }
  return false;
}
