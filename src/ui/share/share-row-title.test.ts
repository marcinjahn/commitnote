import { describe, expect, it } from "vitest";
import type { ShareEntry } from "../../share/share-index";
import { shareRowTitle } from "./share-row-title";

function entry(overrides: Partial<ShareEntry> = {}): ShareEntry {
  return {
    id: "s1",
    locator: { provider: "github", gistId: "g1" },
    linkSecret: "secret",
    password: null,
    name: "Stored",
    label: null,
    sharedAt: "2026-01-01T00:00:00.000Z",
    note: { state: "active", path: ["Folder", "Live"] },
    source: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("shareRowTitle", () => {
  it("titles an unnamed active share with the live note name", () => {
    expect(shareRowTitle(entry())).toEqual({ title: "Live", noteName: null });
  });

  it("titles an unnamed trashed share with the stored name", () => {
    const trashed = entry({ note: { state: "trashed", entryId: "t1", path: ["Old"] } });
    expect(shareRowTitle(trashed)).toEqual({ title: "Stored", noteName: null });
  });

  it("titles an unnamed deleted share with the stored name", () => {
    expect(shareRowTitle(entry({ note: { state: "deleted" } }))).toEqual({
      title: "Stored",
      noteName: null,
    });
  });

  it("shows the label with the live note name beside it", () => {
    expect(shareRowTitle(entry({ label: "For Anna" }))).toEqual({
      title: "For Anna",
      noteName: "Live",
    });
  });

  it("shows the stored name beside the label when the note is deleted", () => {
    expect(shareRowTitle(entry({ label: "For Anna", note: { state: "deleted" } }))).toEqual({
      title: "For Anna",
      noteName: "Stored",
    });
  });

  it("omits the note name when the label equals it", () => {
    expect(shareRowTitle(entry({ label: "Live" }))).toEqual({ title: "Live", noteName: null });
  });

  it("follows a live rename of an active note", () => {
    const renamed = entry({ label: "For Anna", note: { state: "active", path: ["Folder", "Renamed"] } });
    expect(shareRowTitle(renamed).noteName).toBe("Renamed");
  });
});
