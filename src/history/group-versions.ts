import type { NoteVersion } from "./note-history";

/** Longest gap between two saves of one editing session. */
export const SESSION_GAP_MS = 10 * 60 * 1000;

/** One list row: a single version, or an editing session of several saves. */
export interface VersionGroup {
  /** Newest first; the first one is the state the row stands for. */
  readonly versions: readonly NoteVersion[];
}

function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isEditOnly(version: NoteVersion): boolean {
  return version.events.length === 0;
}

/**
 * Groups consecutive edit-only versions of the same day saved at most
 * SESSION_GAP_MS apart. `versions` is newest first.
 */
export function groupVersions(
  versions: readonly NoteVersion[],
  dayOf: (ms: number) => string = localDay,
): VersionGroup[] {
  const groups: NoteVersion[][] = [];
  let current: NoteVersion[] | null = null;
  for (const version of versions) {
    const previous = current?.[current.length - 1];
    if (
      current !== null &&
      previous !== undefined &&
      isEditOnly(previous) &&
      isEditOnly(version) &&
      previous.committedAt - version.committedAt <= SESSION_GAP_MS &&
      dayOf(previous.committedAt) === dayOf(version.committedAt)
    ) {
      current.push(version);
      continue;
    }
    current = [version];
    groups.push(current);
  }
  return groups.map((group) => ({ versions: group }));
}
