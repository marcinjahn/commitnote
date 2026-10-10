import { describe, expect, it } from "vitest";
import type { NotePath } from "../../changes/change";
import { createRecentNotes, RECENT_NOTES_LIMIT } from "./recent-notes";

const note = (name: string): NotePath => ["Folder", name];

describe("createRecentNotes", () => {
  it("lists nothing before any note was recorded", () => {
    expect(createRecentNotes().list(null)).toEqual([]);
  });

  it("lists the most recent note first", () => {
    const recent = createRecentNotes();
    recent.record(note("a"));
    recent.record(note("b"));
    recent.record(note("c"));
    expect(recent.list(null)).toEqual([note("c"), note("b"), note("a")]);
  });

  it("moves a re-recorded note to the front without duplicating it", () => {
    const recent = createRecentNotes();
    recent.record(note("a"));
    recent.record(note("b"));
    recent.record(note("a"));
    expect(recent.list(null)).toEqual([note("a"), note("b")]);
  });

  it("treats equal but distinct path arrays as the same note", () => {
    const recent = createRecentNotes();
    recent.record(["x", "a"]);
    recent.record(["x", "a"]);
    expect(recent.list(null)).toEqual([["x", "a"]]);
  });

  it("excludes the current note", () => {
    const recent = createRecentNotes();
    recent.record(note("a"));
    recent.record(note("b"));
    expect(recent.list(["Folder", "b"])).toEqual([note("a")]);
  });

  it("keeps the limit after excluding the current note", () => {
    const recent = createRecentNotes();
    for (let i = 0; i < RECENT_NOTES_LIMIT + 5; i++) recent.record(note(`n${i}`));
    const current = note(`n${RECENT_NOTES_LIMIT + 4}`);
    const listed = recent.list(current);
    expect(listed).toHaveLength(RECENT_NOTES_LIMIT);
    expect(listed[0]).toEqual(note(`n${RECENT_NOTES_LIMIT + 3}`));
    expect(recent.list(null)).toHaveLength(RECENT_NOTES_LIMIT);
  });

  it("returns fresh arrays", () => {
    const recent = createRecentNotes();
    recent.record(note("a"));
    expect(recent.list(null)).not.toBe(recent.list(null));
  });
});
