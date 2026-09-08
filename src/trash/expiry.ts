import { TRASH_RETENTION_MS } from "../format/v1";
import {
  MAX_PURGE_ENTRIES_PER_STARTUP,
  MAX_PURGE_FILES_PER_COMMIT,
} from "../sync/tuning";
import type { TrashEntry } from "./trash-index";

export interface PurgeCaps {
  readonly maxEntries: number;
  readonly maxFilesPerCommit: number;
}

export const DEFAULT_PURGE_CAPS: PurgeCaps = {
  maxEntries: MAX_PURGE_ENTRIES_PER_STARTUP,
  maxFilesPerCommit: MAX_PURGE_FILES_PER_COMMIT,
};

export function isExpired(entry: TrashEntry, now: number): boolean {
  return now - entry.deletedAt >= TRASH_RETENTION_MS;
}

/**
 * Returns expired entries oldest first, grouped into per-commit batches.
 * An entry is never split across batches, so one larger than
 * `maxFilesPerCommit` gets a batch of its own.
 */
export function selectExpired(
  entries: readonly TrashEntry[],
  now: number,
  caps: PurgeCaps = DEFAULT_PURGE_CAPS,
): TrashEntry[][] {
  const expired = entries
    .filter((entry) => isExpired(entry, now))
    .sort(
      (a, b) =>
        a.deletedAt - b.deletedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, caps.maxEntries);

  const batches: TrashEntry[][] = [];
  let current: TrashEntry[] = [];
  let currentFiles = 0;
  for (const entry of expired) {
    const files = entry.files.length;
    if (current.length > 0 && currentFiles + files > caps.maxFilesPerCommit) {
      batches.push(current);
      current = [];
      currentFiles = 0;
    }
    current.push(entry);
    currentFiles += files;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
