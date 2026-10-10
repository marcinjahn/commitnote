import { describe, expect, it } from "vitest";
import type { NotePath } from "../../changes/change";
import { buildSyncStatusMenu, describeNoteLocation } from "./sync-status-menu";

const paths = (count: number): NotePath[] =>
  Array.from({ length: count }, (_, i) => ["Folder", `Note ${i}`]);

const build = (notes: readonly NotePath[], others = 0, canRetry = false) =>
  buildSyncStatusMenu({ notes, others, canRetry });

describe("describeNoteLocation", () => {
  it("is the name alone for a root note", () => {
    expect(describeNoteLocation(["Inbox"])).toBe("Inbox");
  });

  it("appends the folders for a nested note", () => {
    expect(describeNoteLocation(["Work", "Plans", "Q3"])).toBe("Q3 — Work / Plans");
  });
});

describe("buildSyncStatusMenu", () => {
  it("shows a disabled placeholder when nothing is unsaved", () => {
    const { items } = build([]);
    expect(items).toEqual([
      expect.objectContaining({ id: "none", label: "No unsaved changes", disabled: true, icon: [] }),
    ]);
  });

  it("lists a single note without a more row", () => {
    const { items } = build(paths(1));
    expect(items.map((item) => item.id)).toEqual(["note-0"]);
    expect(items[0]?.label).toBe("Note 0 — Folder");
  });

  it("lists five notes without a more row", () => {
    expect(build(paths(5)).items.map((item) => item.id)).toEqual([
      "note-0",
      "note-1",
      "note-2",
      "note-3",
      "note-4",
    ]);
  });

  it("summarises notes beyond the fifth", () => {
    const { items } = build(paths(7));
    expect(items).toHaveLength(6);
    expect(items[5]).toMatchObject({ id: "more", label: "and 2 more", disabled: true, icon: [] });
  });

  it("adds other changes to the more count", () => {
    expect(build(paths(7), 3).items[5]?.label).toBe("and 5 more");
    expect(build(paths(2), 1).items[2]?.label).toBe("and 1 more");
  });

  it("describes changes without notes by count", () => {
    expect(build([], 1).items[0]).toMatchObject({ id: "more", label: "1 unsaved change" });
    expect(build([], 4).items[0]).toMatchObject({ id: "more", label: "4 unsaved changes" });
  });

  it("puts retry last only when it can retry", () => {
    expect(build(paths(2)).items.some((item) => item.id === "retry")).toBe(false);
    const { items } = build(paths(7), 1, true);
    expect(items[items.length - 1]).toMatchObject({ id: "retry", label: "Retry now" });
    expect(build([], 0, true).items.map((item) => item.id)).toEqual(["none", "retry"]);
  });

  it("maps note ids back to paths and other ids to null", () => {
    const notes = paths(7);
    const { pathOf } = build(notes, 0, true);
    expect(pathOf("note-0")).toBe(notes[0]);
    expect(pathOf("note-4")).toBe(notes[4]);
    expect(pathOf("note-5")).toBeNull();
    expect(pathOf("more")).toBeNull();
    expect(pathOf("retry")).toBeNull();
    expect(pathOf("none")).toBeNull();
  });
});
