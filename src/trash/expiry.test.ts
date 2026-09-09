import { describe, expect, it } from "vitest";
import { TRASH_RETENTION_MS } from "../format/v1";
import {
  MAX_PURGE_ENTRIES_PER_STARTUP,
  MAX_PURGE_FILES_PER_COMMIT,
} from "../sync/tuning";
import { isExpired, selectExpired } from "./expiry";
import type { TrashEntry } from "./trash-index";

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function entry(id: string, deletedAt: number, fileCount = 1): TrashEntry {
  return {
    id,
    deletedAt,
    undecryptable: true,
    files: Array.from({ length: fileCount }, (_, i) => ({
      storedPath: `.commitnote/trash/${id}/f${i}`,
      sha: `${id}-${i}`,
    })),
  };
}

function ids(batches: readonly (readonly TrashEntry[])[]): string[][] {
  return batches.map((batch) => batch.map((e) => e.id));
}

describe("isExpired", () => {
  it("expires an entry exactly 30 days after deletion", () => {
    expect(TRASH_RETENTION_MS).toBe(30 * DAY);
    expect(isExpired(entry("a", NOW - TRASH_RETENTION_MS), NOW)).toBe(true);
    expect(isExpired(entry("a", NOW - TRASH_RETENTION_MS + 1), NOW)).toBe(
      false,
    );
  });
});

describe("selectExpired", () => {
  it("returns only expired entries, oldest first, including undecryptable ones", () => {
    const entries = [
      entry("fresh", NOW - DAY),
      entry("b", NOW - 40 * DAY),
      entry("a", NOW - 50 * DAY),
      entry("c", NOW - 30 * DAY),
    ];

    expect(ids(selectExpired(entries, NOW))).toEqual([["a", "b", "c"]]);
  });

  it("returns no batches when nothing is expired", () => {
    expect(selectExpired([entry("fresh", NOW)], NOW)).toEqual([]);
  });

  it("caps the number of entries, keeping the oldest", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(`e${i}`, NOW - (40 + i) * DAY),
    );

    const batches = selectExpired(entries, NOW, {
      maxEntries: 3,
      maxFilesPerCommit: 100,
    });

    expect(ids(batches)).toEqual([["e4", "e3", "e2"]]);
  });

  it("splits entries into batches without exceeding the file cap", () => {
    const entries = [
      entry("a", NOW - 50 * DAY, 3),
      entry("b", NOW - 49 * DAY, 2),
      entry("c", NOW - 48 * DAY, 1),
      entry("d", NOW - 47 * DAY, 4),
    ];

    const batches = selectExpired(entries, NOW, {
      maxEntries: 10,
      maxFilesPerCommit: 5,
    });

    expect(ids(batches)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("gives an entry larger than the file cap a batch of its own", () => {
    const entries = [
      entry("a", NOW - 50 * DAY, 1),
      entry("huge", NOW - 49 * DAY, 10),
      entry("c", NOW - 48 * DAY, 1),
    ];

    const batches = selectExpired(entries, NOW, {
      maxEntries: 10,
      maxFilesPerCommit: 5,
    });

    expect(ids(batches)).toEqual([["a"], ["huge"], ["c"]]);
  });

  it("uses the startup entry cap and per-commit file cap by default", () => {
    const entries = Array.from(
      { length: MAX_PURGE_ENTRIES_PER_STARTUP + 5 },
      (_, i) => entry(`e${String(i).padStart(3, "0")}`, NOW - 40 * DAY, 30),
    );

    const batches = selectExpired(entries, NOW);

    expect(batches.flat()).toHaveLength(MAX_PURGE_ENTRIES_PER_STARTUP);
    for (const batch of batches) {
      const files = batch.reduce((sum, e) => sum + e.files.length, 0);
      expect(files).toBeLessThanOrEqual(MAX_PURGE_FILES_PER_COMMIT);
    }
  });
});
