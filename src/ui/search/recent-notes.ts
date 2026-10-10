import { notePathEquals, type NotePath } from "../../changes/change";

export const RECENT_NOTES_LIMIT = 8;

export interface RecentNotes {
  record(path: NotePath): void;
  list(current: NotePath | null): readonly NotePath[];
}

export function createRecentNotes(): RecentNotes {
  let entries: NotePath[] = [];

  return {
    record(path) {
      entries = [path, ...entries.filter((entry) => !notePathEquals(entry, path))].slice(
        0,
        RECENT_NOTES_LIMIT + 1,
      );
    },
    list(current) {
      return entries
        .filter((entry) => current === null || !notePathEquals(entry, current))
        .slice(0, RECENT_NOTES_LIMIT);
    },
  };
}
