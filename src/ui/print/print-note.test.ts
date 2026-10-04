import { describe, expect, it } from "vitest";
import type { HeldConflict, OpenNoteState, SyncError } from "../../sync/sync-engine";
import { derivePrintNote } from "./print-note";

function loaded(path: string[], content: string): OpenNoteState {
  return { kind: "loaded", path, blobSha: null, content };
}

function conflict(path: string[], merged: string, editing: string | null): HeldConflict {
  return { path, base: "", mine: "", theirs: "", theirsBlobSha: "", merged, editing };
}

describe("derivePrintNote", () => {
  it("prefers a draft with a name over the open note", () => {
    const result = derivePrintNote(
      { parent: [], name: "Draft" },
      loaded(["Open"], "body"),
      [],
    );
    expect(result).toEqual({ name: "Draft", text: "" });
  });

  it("allows a draft with an empty name", () => {
    const result = derivePrintNote({ parent: [], name: "" }, loaded(["Open"], "body"), []);
    expect(result).toEqual({ name: "", text: "" });
  });

  it("uses the content of a loaded note", () => {
    expect(derivePrintNote(null, loaded(["Note"], "# Hi"), [])).toEqual({
      name: "Note",
      text: "# Hi",
    });
  });

  it("uses the name of the last path segment", () => {
    expect(derivePrintNote(null, loaded(["A", "B", "Deep"], "x"), [])?.name).toBe("Deep");
  });

  it("prefers the conflict editing text", () => {
    const result = derivePrintNote(null, loaded(["Note"], "disk"), [
      conflict(["Note"], "merged", "editing"),
    ]);
    expect(result).toEqual({ name: "Note", text: "editing" });
  });

  it("falls back to the merged text when the conflict is not being edited", () => {
    const result = derivePrintNote(null, loaded(["Note"], "disk"), [
      conflict(["Note"], "merged", null),
    ]);
    expect(result).toEqual({ name: "Note", text: "merged" });
  });

  it("ignores a conflict for a different path", () => {
    const result = derivePrintNote(null, loaded(["Note"], "disk"), [
      conflict(["Other"], "merged", "editing"),
    ]);
    expect(result).toEqual({ name: "Note", text: "disk" });
  });

  it("returns null when nothing printable is open", () => {
    const path = ["Note"];
    const states: (OpenNoteState | null)[] = [
      null,
      { kind: "loading", path },
      { kind: "missing", path },
      { kind: "failed", path, error: { kind: "network" } satisfies SyncError },
    ];
    for (const state of states) expect(derivePrintNote(null, state, [])).toBeNull();
  });
});
