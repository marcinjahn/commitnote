import { describe, expect, it } from "vitest";
import type { IndexerState, IndexStatus } from "../../search/content-indexer";
import {
  contentSectionHeading,
  describeIndexStatus,
  describeNoMatches,
  describeSearchStatus,
  describeShowingFirst,
  describeUnreadable,
  NAME_SECTION_HEADING,
  SEARCH_HINT,
  SEARCH_PLACEHOLDER,
  SEARCH_TRIGGER_LABEL,
  STILL_READING,
} from "./search-messages";

const NOW = 1_000_000;

describe("describeIndexStatus", () => {
  it.each<[string, IndexStatus, string, string | null]>([
    ["idle", { kind: "idle" }, "GitHub", null],
    ["complete", { kind: "complete" }, "GitHub", null],
    [
      "indexing",
      { kind: "indexing", done: 3, total: 10 },
      "GitHub",
      "Reading notes for content search… 3 of 10",
    ],
    [
      "indexing with thousands",
      { kind: "indexing", done: 1200, total: 12_345 },
      "GitHub",
      "Reading notes for content search… 1,200 of 12,345",
    ],
    [
      "paused, one minute, GitHub",
      { kind: "paused", resumeAt: NOW + 30_000 },
      "GitHub",
      "Content search paused: GitHub rate limit. Resuming in 1 minute.",
    ],
    [
      "paused, several minutes, GitLab",
      { kind: "paused", resumeAt: NOW + 3 * 60_000 },
      "GitLab",
      "Content search paused: GitLab rate limit. Resuming in 3 minutes.",
    ],
    [
      "paused, already due",
      { kind: "paused", resumeAt: NOW - 5_000 },
      "GitLab",
      "Content search paused: GitLab rate limit. Resuming in 1 minute.",
    ],
    [
      "offline",
      { kind: "offline" },
      "GitHub",
      "Content search is offline. Some contents may be missing.",
    ],
    [
      "limited",
      { kind: "limited", covered: 1200, total: 3400 },
      "GitHub",
      "Content search covers 1,200 of 3,400 notes (memory limit).",
    ],
  ])("describes %s", (_name, status, forgeName, expected) => {
    expect(describeIndexStatus(status, forgeName, NOW)).toBe(expected);
  });
});

describe("describeUnreadable", () => {
  it.each<[number, string | null]>([
    [0, null],
    [1, "1 note couldn't be read."],
    [2, "2 notes couldn't be read."],
    [1500, "1,500 notes couldn't be read."],
  ])("describes %i", (count, expected) => {
    expect(describeUnreadable(count)).toBe(expected);
  });
});

describe("describeSearchStatus", () => {
  it.each<[string, IndexerState, string | null]>([
    ["nothing to report", { status: { kind: "complete" }, unreadable: 0 }, null],
    ["idle", { status: { kind: "idle" }, unreadable: 0 }, null],
    [
      "status only",
      { status: { kind: "offline" }, unreadable: 0 },
      "Content search is offline. Some contents may be missing.",
    ],
    [
      "unreadable only",
      { status: { kind: "complete" }, unreadable: 2 },
      "2 notes couldn't be read.",
    ],
    [
      "both",
      { status: { kind: "indexing", done: 1, total: 4 }, unreadable: 1 },
      "Reading notes for content search… 1 of 4 1 note couldn't be read.",
    ],
  ])("combines: %s", (_name, state, expected) => {
    expect(describeSearchStatus(state, "GitHub", NOW)).toBe(expected);
  });
});

describe("headings and labels", () => {
  it("has the section headings", () => {
    expect(NAME_SECTION_HEADING).toBe("Titles");
    expect(contentSectionHeading(false)).toBe("Contents");
    expect(contentSectionHeading(true)).toBe("Contents (partial)");
  });

  it("has the static strings", () => {
    expect(STILL_READING).toBe("Still reading notes…");
    expect(SEARCH_HINT).toBe("Search note titles and contents");
    expect(SEARCH_PLACEHOLDER).toBe("Search notes");
    expect(SEARCH_TRIGGER_LABEL).toBe("Search notes");
  });

  it.each<[number, string]>([
    [50, "Showing first 50"],
    [1000, "Showing first 1,000"],
  ])("describes showing first %i", (count, expected) => {
    expect(describeShowingFirst(count)).toBe(expected);
  });
});

describe("describeNoMatches", () => {
  it.each<[string, string]>([
    ["foo", "No notes match “foo”"],
    ["  foo bar \n", "No notes match “foo bar”"],
  ])("describes %j", (query, expected) => {
    expect(describeNoMatches(query)).toBe(expected);
  });
});
