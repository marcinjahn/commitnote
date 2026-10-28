import { describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import type { SyncEngine } from "../sync/sync-engine";
import type { WorkingTree } from "../sync/working-tree";
import { describeStructureError } from "../ui/browse/structure-messages";
import { describeNameError } from "../ui/dialogs/name-messages";
import {
  commitNoteDraftContent,
  commitNoteDraftName,
  draftSiblingNames,
} from "./note-draft-actions";

type Engine = Pick<SyncEngine, "createNote" | "editNote">;

function stubEngine(failWith?: "notFound"): {
  engine: Engine;
  createNote: ReturnType<typeof vi.fn>;
  editNote: ReturnType<typeof vi.fn>;
} {
  const createNote = vi.fn((parent: NotePath, name: string) =>
    failWith === undefined
      ? { ok: true as const, path: [...parent, name] }
      : { ok: false as const, error: { kind: failWith } },
  );
  const editNote = vi.fn();
  return {
    engine: { createNote, editNote } as unknown as Engine,
    createNote,
    editNote,
  };
}

const NOW = new Date(2026, 0, 2, 3, 4, 5);
const AUTO = "2026-01-02 03:04:05";

describe("commitNoteDraftName", () => {
  it("creates the note under the confirmed name", () => {
    const { engine, createNote } = stubEngine();
    const outcome = commitNoteDraftName(engine, { parent: ["A"], name: "Plan" }, []);
    expect(outcome).toEqual({ kind: "created", path: ["A", "Plan"], fieldError: null });
    expect(createNote).toHaveBeenCalledWith(["A"], "Plan");
  });

  it("reports a duplicate name without creating", () => {
    const { engine, createNote } = stubEngine();
    const outcome = commitNoteDraftName(engine, { parent: [], name: "Plan" }, ["Plan"]);
    expect(outcome.kind).toBe("error");
    expect(createNote).not.toHaveBeenCalled();
  });

  it("reports an invalid name", () => {
    const { engine } = stubEngine();
    const outcome = commitNoteDraftName(engine, { parent: [], name: "a/b" }, []);
    expect(outcome.kind).toBe("error");
  });

  it("describes a failed creation", () => {
    const { engine } = stubEngine("notFound");
    expect(commitNoteDraftName(engine, { parent: [], name: "Plan" }, [])).toEqual({
      kind: "error",
      message: describeStructureError({ kind: "notFound" }),
    });
  });

  it("does nothing for a blank name", () => {
    const { engine, createNote } = stubEngine();
    expect(commitNoteDraftName(engine, { parent: [], name: "" }, [])).toEqual({
      kind: "none",
    });
    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("commitNoteDraftContent", () => {
  it("creates under the typed name and writes the content", () => {
    const { engine, editNote } = stubEngine();
    const outcome = commitNoteDraftContent(
      engine,
      { parent: [], name: "Plan" },
      "hello",
      NOW,
      [],
    );
    expect(outcome).toEqual({ kind: "created", path: ["Plan"], fieldError: null });
    expect(editNote).toHaveBeenCalledWith(["Plan"], "hello");
  });

  it("falls back to the auto name for a blank name", () => {
    const { engine } = stubEngine();
    const outcome = commitNoteDraftContent(
      engine,
      { parent: [], name: "" },
      "hello",
      NOW,
      [],
    );
    expect(outcome).toEqual({ kind: "created", path: [AUTO], fieldError: null });
  });

  it("suffixes the auto name on a clash", () => {
    const { engine } = stubEngine();
    const outcome = commitNoteDraftContent(
      engine,
      { parent: [], name: "" },
      "hello",
      NOW,
      [AUTO],
    );
    expect(outcome).toEqual({ kind: "created", path: [`${AUTO} (2)`], fieldError: null });
  });

  it("keeps the field error for an invalid name", () => {
    const { engine } = stubEngine();
    const outcome = commitNoteDraftContent(
      engine,
      { parent: [], name: "a/b" },
      "hello",
      NOW,
      [],
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") {
      expect(outcome.path).toEqual([AUTO]);
      expect(outcome.fieldError).toBe(describeNameError({ kind: "containsSlash" }));
    }
  });

  it("does not write content when creation fails", () => {
    const { engine, editNote } = stubEngine("notFound");
    const outcome = commitNoteDraftContent(
      engine,
      { parent: [], name: "Plan" },
      "hello",
      NOW,
      [],
    );
    expect(outcome).toEqual({
      kind: "error",
      message: describeStructureError({ kind: "notFound" }),
    });
    expect(editNote).not.toHaveBeenCalled();
  });
});

describe("draftSiblingNames", () => {
  const tree = {
    root: {
      kind: "folder",
      name: "",
      path: [],
      children: [
        {
          kind: "folder",
          name: "A",
          path: ["A"],
          children: [
            { kind: "note", name: "x", path: ["A", "x"] },
            { kind: "note", name: "y", path: ["A", "y"] },
          ],
        },
        { kind: "note", name: "top", path: ["top"] },
      ],
    },
  } as unknown as WorkingTree;

  it("lists the children of the folder", () => {
    expect(draftSiblingNames(tree, ["A"])).toEqual(["x", "y"]);
  });

  it("is empty for a missing tree, a missing folder or a note", () => {
    expect(draftSiblingNames(null, ["A"])).toEqual([]);
    expect(draftSiblingNames(tree, ["Nope"])).toEqual([]);
    expect(draftSiblingNames(tree, ["top"])).toEqual([]);
  });
});
