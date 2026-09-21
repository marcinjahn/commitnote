import { describe, expect, it } from "vitest";
import type { ChangeSet, NotePath } from "../changes/change";
import { buildNotesArchive } from "../export/notes-archive";
import { MAX_NAME_BYTES } from "../format/v1";
import {
  buildWorkingTree,
  localContentAt,
  type WorkingFolder,
  type WorkingTree,
} from "../sync/working-tree";
import type { FolderNode, NoteNode, NoteTree } from "../tree/note-tree";
import { planImport, type ImportDestination, type ImportPlan } from "./plan-import";
import { readNotesArchive, type ArchiveImportEntry } from "./read-notes-archive";

type Spec = { readonly [name: string]: Spec | string };

function syncedTree(spec: Spec): NoteTree {
  function build(name: string, path: NotePath, children: Spec): FolderNode {
    return {
      kind: "folder",
      name,
      path,
      storedPath: path.join("/"),
      children: Object.entries(children).map(([childName, value]) => {
        const childPath = [...path, childName];
        if (typeof value === "string") {
          const note: NoteNode = {
            kind: "note",
            name: childName,
            path: childPath,
            storedPath: childPath.join("/"),
            blobSha: `sha-${childPath.join("/")}`,
          };
          return note;
        }
        return build(childName, childPath, value);
      }),
    };
  }
  return { root: build("", [], spec) };
}

function shape(folder: WorkingFolder): Spec {
  const result: Record<string, Spec | string> = {};
  for (const child of folder.children) {
    result[child.name] = child.kind === "folder" ? shape(child) : "note";
  }
  return result;
}

function note(name: string): ArchiveImportEntry {
  return { kind: "note", path: name.split("/"), content: `content of ${name}` };
}

function dir(name: string): ArchiveImportEntry {
  return { kind: "folder", path: name.split("/") };
}

const ROOT: ImportDestination = { kind: "root" };

function applied(synced: NoteTree, plan: ImportPlan): WorkingTree {
  if (!plan.ok) throw new Error("expected a successful plan");
  return buildWorkingTree(synced, plan.changes);
}

function plan(
  spec: Spec,
  entries: readonly ArchiveImportEntry[],
  destination: ImportDestination = ROOT,
  policy: "stop" | "rename" = "rename",
): { synced: NoteTree; result: ImportPlan; after: () => WorkingTree } {
  const synced = syncedTree(spec);
  const result = planImport(
    buildWorkingTree(synced, []),
    destination,
    entries,
    policy,
  );
  return { synced, result, after: () => applied(synced, result) };
}

function changesOf(result: ImportPlan): ChangeSet {
  if (!result.ok) throw new Error("expected a successful plan");
  return result.changes;
}

describe("planImport", () => {
  it("round-trips an exported tree into an empty repository", async () => {
    const source = buildWorkingTree(
      syncedTree({
        Journal: { "2026": { January: "", February: "" }, Empty: {} },
        Ideas: "",
        "Zażółć gęślą jaźń": "",
        Docs: { Guide: "" },
      }),
      [],
    );
    const archive = await buildNotesArchive(
      source.root,
      async (path) => `# ${path.join(" / ")}\n`,
      new Date(2026, 8, 30),
    );
    const { entries, skipped } = readNotesArchive(archive);

    const synced = syncedTree({});
    const result = planImport(buildWorkingTree(synced, []), ROOT, entries, "stop");
    const after = applied(synced, result);

    expect(Object.values(skipped).every((count) => count === 0)).toBe(true);
    expect(shape(after.root)).toEqual(shape(source.root));
    expect(localContentAt(changesOf(result), ["Journal", "2026", "January"])).toBe(
      "# Journal / 2026 / January\n",
    );
    expect(result).toMatchObject({
      summary: { notes: 5, folders: 4, renamed: 0, conflicts: 0 },
    });
  });

  it("creates folders before their contents, including missing parents", () => {
    const { result } = plan({}, [note("a/b/c")]);

    expect(changesOf(result)).toEqual([
      { kind: "create-folder", path: ["a"] },
      { kind: "create-folder", path: ["a", "b"] },
      { kind: "create-note", path: ["a", "b", "c"], content: "content of a/b/c" },
    ]);
  });

  it("imports nothing from an empty archive", () => {
    const { result } = plan({ Existing: "" }, []);

    expect(result).toEqual({
      ok: true,
      changes: [],
      summary: { notes: 0, folders: 0, renamed: 0, conflicts: 0 },
    });
  });

  describe("destinations", () => {
    it("imports into an existing folder", () => {
      const { result, after } = plan(
        { Inbox: { Old: "" } },
        [note("New"), note("sub/Deep")],
        { kind: "folder", path: ["Inbox"] },
      );

      expect(shape(after().root)).toEqual({
        Inbox: { sub: { Deep: "note" }, New: "note", Old: "note" },
      });
      expect(result).toMatchObject({ summary: { notes: 2, folders: 1 } });
    });

    it("imports into a new folder under the given parent", () => {
      const { result, after } = plan(
        { Archive: {} },
        [note("a"), dir("empty")],
        { kind: "new-folder", parent: ["Archive"], name: " Imported " },
      );

      expect(shape(after().root)).toEqual({
        Archive: { Imported: { empty: {}, a: "note" } },
      });
      expect(result).toMatchObject({ summary: { notes: 1, folders: 2 } });
    });

    it("creates an empty new folder for an empty archive", () => {
      const { result } = plan({}, [], {
        kind: "new-folder",
        parent: [],
        name: "Imported",
      });

      expect(changesOf(result)).toEqual([
        { kind: "create-folder", path: ["Imported"] },
      ]);
    });

    it("treats a new folder clashing with an existing folder as a conflict", () => {
      const destination: ImportDestination = {
        kind: "new-folder",
        parent: [],
        name: "imported",
      };
      const entries = [note("a")];

      expect(plan({ Imported: { a: "" } }, entries, destination, "stop").result).toEqual({
        ok: false,
        reason: "conflicts",
        conflicts: 1,
      });

      const renamed = plan({ Imported: { a: "" } }, entries, destination, "rename");
      expect(shape(renamed.after().root)).toEqual({
        Imported: { a: "note" },
        "imported (2)": { a: "note" },
      });
      expect(renamed.result).toMatchObject({
        summary: { notes: 1, folders: 1, renamed: 1, conflicts: 1 },
      });
    });

    it.each<ImportDestination>([
      { kind: "folder", path: ["Missing"] },
      { kind: "folder", path: ["Note"] },
      { kind: "new-folder", parent: ["Missing"], name: "x" },
      { kind: "new-folder", parent: [], name: "a/b" },
      { kind: "new-folder", parent: [], name: "  " },
    ])("rejects the invalid destination %j", (destination) => {
      const tree = buildWorkingTree(syncedTree({ Note: "" }), []);

      expect(() => planImport(tree, destination, [note("a")], "rename")).toThrow(
        RangeError,
      );
    });
  });

  describe("collisions", () => {
    it("stops without changes when any imported name clashes", () => {
      const { result } = plan(
        { A: "", Docs: { Guide: "" } },
        [note("a"), note("Docs/guide"), note("Docs/Fresh"), note("B")],
        ROOT,
        "stop",
      );

      expect(result).toEqual({ ok: false, reason: "conflicts", conflicts: 2 });
    });

    it("succeeds under the stop policy when nothing clashes", () => {
      const { result, after } = plan(
        { Docs: { Guide: "" } },
        [note("Docs/Fresh")],
        ROOT,
        "stop",
      );

      expect(shape(after().root)).toEqual({
        Docs: { Fresh: "note", Guide: "note" },
      });
      expect(result).toMatchObject({ summary: { renamed: 0, conflicts: 0 } });
    });

    it("merges into existing folders with the same name", () => {
      const { result, after } = plan(
        { Docs: { Guide: "", Sub: { Old: "" } } },
        [dir("Docs"), note("Docs/Sub/New"), dir("Docs/Sub/Empty")],
        ROOT,
        "stop",
      );

      expect(changesOf(result)).toEqual([
        { kind: "create-folder", path: ["Docs", "Sub", "Empty"] },
        {
          kind: "create-note",
          path: ["Docs", "Sub", "New"],
          content: "content of Docs/Sub/New",
        },
      ]);
      expect(shape(after().root)).toEqual({
        Docs: { Sub: { Empty: {}, New: "note", Old: "note" }, Guide: "note" },
      });
    });

    it("renames clashing notes with the next free number", () => {
      const { result, after } = plan(
        { Plan: "", "Plan (2)": "", "plan (3)": "", Other: "" },
        [note("Plan")],
      );

      expect(changesOf(result)).toEqual([
        { kind: "create-note", path: ["Plan (4)"], content: "content of Plan" },
      ]);
      expect(Object.keys(shape(after().root))).toContain("Plan (4)");
      expect(result).toMatchObject({ summary: { renamed: 1, conflicts: 1 } });
    });

    it("renames names that clash only by letter case", () => {
      const { result, after } = plan({ Notes: "", Docs: {} }, [
        note("notes"),
        note("docs/inner"),
      ]);

      expect(shape(after().root)).toEqual({
        Docs: {},
        "docs (2)": { inner: "note" },
        Notes: "note",
        "notes (2)": "note",
      });
      expect(result).toMatchObject({
        summary: { notes: 2, folders: 1, renamed: 2, conflicts: 2 },
      });
    });

    it("renames a note that clashes with an existing folder and vice versa", () => {
      const { result, after } = plan({ Topic: {}, Item: "" }, [
        note("Topic"),
        note("Item/child"),
      ]);

      expect(shape(after().root)).toEqual({
        "Item (2)": { child: "note" },
        Topic: {},
        Item: "note",
        "Topic (2)": "note",
      });
      expect(result).toMatchObject({ summary: { renamed: 2, conflicts: 2 } });
    });

    it("stops on a kind clash under the stop policy", () => {
      const { result } = plan({ Topic: {} }, [note("Topic")], ROOT, "stop");

      expect(result).toEqual({ ok: false, reason: "conflicts", conflicts: 1 });
    });

    it("keeps imported siblings apart from each other and from renamed names", () => {
      const { result, after } = plan({ x: "" }, [
        note("x"),
        note("X"),
        dir("x"),
        note("x (2)"),
      ]);

      const names = Object.keys(shape(after().root));
      expect(names).toHaveLength(5);
      expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(5);
      expect(result).toMatchObject({
        summary: { notes: 3, folders: 1, conflicts: 3 },
      });
    });

    it("renames clashes between imported siblings even under the stop policy", () => {
      const { result, after } = plan({}, [note("a"), note("A"), dir("a")], ROOT, "stop");

      expect(shape(after().root)).toEqual({
        a: {},
        "A (2)": "note",
        "a (3)": "note",
      });
      expect(result).toMatchObject({ summary: { renamed: 2, conflicts: 0 } });
    });

    it("renames deep in a merged folder without touching outer folders", () => {
      const { result, after } = plan(
        { Docs: { Sub: { Page: "", "Page (2)": "" } } },
        [note("Docs/Sub/Page")],
      );

      expect(changesOf(result)).toEqual([
        {
          kind: "create-note",
          path: ["Docs", "Sub", "Page (3)"],
          content: "content of Docs/Sub/Page",
        },
      ]);
      expect(shape(after().root)).toEqual({
        Docs: { Sub: { Page: "note", "Page (2)": "note", "Page (3)": "note" } },
      });
    });

    it("shortens a renamed name to stay within the name length limit", () => {
      const long = "é".repeat(MAX_NAME_BYTES / 2);
      const { result } = plan({ [long]: "" }, [note(long)]);

      const [change] = changesOf(result);
      const name = (change as { path: NotePath }).path[0];
      expect(name.endsWith(" (2)")).toBe(true);
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(
        MAX_NAME_BYTES,
      );
    });

    it("never changes existing items", () => {
      const { result } = plan(
        { Docs: { Guide: "" }, Guide: "" },
        [note("Docs/Guide"), note("Guide"), dir("Docs")],
      );

      for (const change of changesOf(result)) {
        expect(["create-note", "create-folder"]).toContain(change.kind);
      }
    });
  });
});
