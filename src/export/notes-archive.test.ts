import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { WorkingFolder, WorkingNode } from "../sync/working-tree";
import { buildNotesArchive } from "./notes-archive";

function note(parent: NotePath, name: string): WorkingNode {
  const path = [...parent, name];
  return { kind: "note", name, path, syncedPath: path, colorTag: null, shared: false };
}

function folder(
  parent: NotePath,
  name: string,
  children: (path: NotePath) => WorkingNode[],
): WorkingFolder {
  const path = [...parent, name];
  return { kind: "folder", name, path, children: children(path) };
}

function root(children: (path: NotePath) => WorkingNode[]): WorkingFolder {
  return { kind: "folder", name: "", path: [], children: children([]) };
}

const MTIME = new Date(2026, 8, 30, 12, 0, 0);

async function unzip(
  tree: WorkingFolder,
  readNote: (path: NotePath) => Promise<string> = async (path) =>
    `content of ${path.join("|")}`,
): Promise<Record<string, string>> {
  const archive = await buildNotesArchive(tree, readNote, MTIME);
  const files = unzipSync(archive);
  return Object.fromEntries(
    Object.entries(files).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe("buildNotesArchive", () => {
  it("mirrors the folder structure with note contents as .md files", async () => {
    const tree = root((r) => [
      folder(r, "Journal", (j) => [
        folder(j, "2026", (y) => [note(y, "January")]),
      ]),
      folder(r, "Empty folder", () => []),
      note(r, "Zażółć gęślą jaźń"),
    ]);

    expect(await unzip(tree)).toEqual({
      "Journal/": "",
      "Journal/2026/": "",
      "Journal/2026/January.md": "content of Journal|2026|January",
      "Empty folder/": "",
      "Zażółć gęślą jaźń.md": "content of Zażółć gęślą jaźń",
    });
  });

  it("keeps an existing .md extension instead of doubling it", async () => {
    const tree = root((r) => [note(r, "Readme.md"), note(r, "notes.MD")]);

    expect(Object.keys(await unzip(tree))).toEqual(["Readme.md", "notes.MD"]);
  });

  it("replaces path separators and dot-only names with safe segments", async () => {
    const tree = root((r) => [
      folder(r, "..", (f) => [note(f, "a/b"), note(f, "c\\d")]),
      note(r, "."),
    ]);

    expect(Object.keys(await unzip(tree))).toEqual([
      "_/",
      "_/a_b.md",
      "_/c_d.md",
      "_.md",
    ]);
  });

  it("numbers names that collide after conversion, ignoring case", async () => {
    const tree = root((r) => [
      folder(r, "Plan.md", () => []),
      note(r, "Plan"),
      note(r, "plan.md"),
      note(r, "a/b"),
      note(r, "a_b"),
    ]);

    expect(Object.keys(await unzip(tree))).toEqual([
      "Plan.md/",
      "Plan (2).md",
      "plan (3).md",
      "a_b.md",
      "a_b (2).md",
    ]);
  });

  it("stores each note's content under its own file", async () => {
    const tree = root((r) => [
      note(r, "One"),
      note(r, "Two"),
      note(r, "Three"),
    ]);
    const texts: Record<string, string> = {
      One: "1",
      Two: "2",
      Three: "3",
    };

    const files = await unzip(tree, async (path) => {
      await new Promise((resolve) => setTimeout(resolve, path[0].length));
      return texts[path[0]];
    });

    expect(files).toEqual({ "One.md": "1", "Two.md": "2", "Three.md": "3" });
  });

  it("produces an empty archive when there are no notes", async () => {
    expect(await unzip(root(() => []))).toEqual({});
  });
});
