import { describe, expect, it } from "vitest";
import { clampNotePosition, createNotePositions } from "./note-position";

describe("clampNotePosition", () => {
  it("keeps a position inside the document", () => {
    expect(clampNotePosition({ anchor: 2, head: 5, scrollTop: 120 }, 10)).toEqual({
      anchor: 2,
      head: 5,
      scrollTop: 120,
    });
  });

  it("clamps a selection beyond the end to the document length", () => {
    expect(clampNotePosition({ anchor: 12, head: 40, scrollTop: 0 }, 10)).toEqual({
      anchor: 10,
      head: 10,
      scrollTop: 0,
    });
  });

  it("clamps negative values to zero", () => {
    expect(clampNotePosition({ anchor: -3, head: -1, scrollTop: -50 }, 10)).toEqual({
      anchor: 0,
      head: 0,
      scrollTop: 0,
    });
  });

  it("collapses the selection to zero in an empty document", () => {
    expect(clampNotePosition({ anchor: 4, head: 7, scrollTop: 30 }, 0)).toEqual({
      anchor: 0,
      head: 0,
      scrollTop: 30,
    });
  });
});

describe("createNotePositions", () => {
  it("returns nothing for a path never saved", () => {
    expect(createNotePositions().get(["Welcome"])).toBeUndefined();
  });

  it("keeps positions of distinct paths apart", () => {
    const positions = createNotePositions();
    positions.save(["Welcome"], { anchor: 1, head: 1, scrollTop: 10 });
    positions.save(["Projects", "Ideas"], { anchor: 2, head: 3, scrollTop: 20 });

    expect(positions.get(["Welcome"])).toEqual({ anchor: 1, head: 1, scrollTop: 10 });
    expect(positions.get(["Projects", "Ideas"])).toEqual({
      anchor: 2,
      head: 3,
      scrollTop: 20,
    });
  });

  it("overwrites the position saved earlier for the same path", () => {
    const positions = createNotePositions();
    positions.save(["Welcome"], { anchor: 1, head: 1, scrollTop: 10 });
    positions.save(["Welcome"], { anchor: 5, head: 6, scrollTop: 40 });

    expect(positions.get(["Welcome"])).toEqual({ anchor: 5, head: 6, scrollTop: 40 });
  });

  it("does not confuse a slash in a name with a folder boundary", () => {
    const positions = createNotePositions();
    positions.save(["a/b"], { anchor: 1, head: 1, scrollTop: 1 });
    positions.save(["a", "b"], { anchor: 2, head: 2, scrollTop: 2 });

    expect(positions.get(["a/b"])).toEqual({ anchor: 1, head: 1, scrollTop: 1 });
    expect(positions.get(["a", "b"])).toEqual({ anchor: 2, head: 2, scrollTop: 2 });
  });
});
