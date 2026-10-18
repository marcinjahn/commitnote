import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { NotePath } from "../changes/change";
import type { WorkingFolder, WorkingNode } from "../sync/working-tree";
import type { ImagePayload } from "../crypto/image-cipher";
import type { ReadImagePayload } from "../images/image-resolver";
import { buildNotesArchive, EXPORT_IMAGES_DIR } from "./notes-archive";

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

  describe("images", () => {
    const WEBP_ID = "a".repeat(26);
    const GIF_ID = "b".repeat(26);
    const WEBP_BYTES = new Uint8Array([1, 2, 3, 250]);
    const GIF_BYTES = new Uint8Array([71, 73, 70, 0, 255]);
    const PAYLOADS: Record<string, ImagePayload> = {
      [WEBP_ID]: { type: "image/webp", width: 4, height: 3, bytes: WEBP_BYTES },
      [GIF_ID]: { type: "image/gif", width: 2, height: 2, bytes: GIF_BYTES },
    };
    const readImage: ReadImagePayload = async (id) => PAYLOADS[id] ?? null;

    async function build(
      text: string,
      tree: WorkingFolder,
      reader: ReadImagePayload | undefined = readImage,
    ) {
      const archive = await buildNotesArchive(
        tree,
        async () => text,
        MTIME,
        reader,
      );
      return unzipSync(archive);
    }

    it("writes images next to a nested note and rewrites its references", async () => {
      const text = `before ![one](image:${WEBP_ID}#4x3) middle ![two \\]](image:${GIF_ID}#2x2) after`;
      const tree = root((r) => [folder(r, "Trips", (t) => [note(t, "Paris")])]);

      const files = await build(text, tree);

      expect(Object.keys(files).sort()).toEqual([
        "Trips/",
        "Trips/Paris.md",
        `Trips/${EXPORT_IMAGES_DIR}/${WEBP_ID}.webp`,
        `Trips/${EXPORT_IMAGES_DIR}/${GIF_ID}.gif`,
      ]);
      expect(files[`Trips/_images/${WEBP_ID}.webp`]).toEqual(WEBP_BYTES);
      expect(files[`Trips/_images/${GIF_ID}.gif`]).toEqual(GIF_BYTES);
      expect(strFromU8(files["Trips/Paris.md"])).toBe(
        `before ![one](_images/${WEBP_ID}.webp) middle ![two \\]](_images/${GIF_ID}.gif) after`,
      );
    });

    it("puts images of a root note in a root _images folder", async () => {
      const files = await build(
        `![](image:${WEBP_ID}#4x3)`,
        root((r) => [note(r, "Top")]),
      );

      expect(Object.keys(files).sort()).toEqual([
        "Top.md",
        `_images/${WEBP_ID}.webp`,
      ]);
      expect(strFromU8(files["Top.md"])).toBe(`![](_images/${WEBP_ID}.webp)`);
    });

    it("writes one file for an image referenced twice in a note", async () => {
      const reads: string[] = [];
      const files = await build(
        `![a](image:${WEBP_ID}#4x3) ![b](image:${WEBP_ID}#4x3)`,
        root((r) => [note(r, "Top")]),
        async (id) => {
          reads.push(id);
          return PAYLOADS[id] ?? null;
        },
      );

      expect(reads).toEqual([WEBP_ID]);
      expect(Object.keys(files).sort()).toEqual([
        "Top.md",
        `_images/${WEBP_ID}.webp`,
      ]);
      expect(strFromU8(files["Top.md"])).toBe(
        `![a](_images/${WEBP_ID}.webp) ![b](_images/${WEBP_ID}.webp)`,
      );
    });

    it("leaves a reference as written when its image is unavailable", async () => {
      const text = `![gone](image:${WEBP_ID}#4x3)`;
      const files = await build(
        text,
        root((r) => [note(r, "Top")]),
        async () => null,
      );

      expect(Object.keys(files)).toEqual(["Top.md"]);
      expect(strFromU8(files["Top.md"])).toBe(text);
    });

    it("fails the export when reading an image fails", async () => {
      await expect(
        build(
          `![x](image:${WEBP_ID}#4x3)`,
          root((r) => [note(r, "Top")]),
          async () => {
            throw new Error("offline");
          },
        ),
      ).rejects.toThrow("offline");
    });

    it("ignores references inside code", async () => {
      const text = "```\n![x](image:" + WEBP_ID + "#4x3)\n```";
      const reads: string[] = [];
      const files = await build(
        text,
        root((r) => [note(r, "Top")]),
        async (id) => {
          reads.push(id);
          return PAYLOADS[id] ?? null;
        },
      );

      expect(reads).toEqual([]);
      expect(Object.keys(files)).toEqual(["Top.md"]);
      expect(strFromU8(files["Top.md"])).toBe(text);
    });

    it("produces the same archive without an image reader", async () => {
      const tree = root((r) => [
        folder(r, "Trips", (t) => [note(t, "Paris")]),
        note(r, "Top"),
      ]);
      const text = `![a](image:${WEBP_ID}#4x3)`;
      const readNote = async () => text;

      const plain = await buildNotesArchive(tree, readNote, MTIME);
      const withoutImages = await buildNotesArchive(
        tree,
        async () => "no images",
        MTIME,
        readImage,
      );
      const withoutReader = unzipSync(plain);

      expect(Object.keys(withoutReader)).toEqual(["Trips/", "Trips/Paris.md", "Top.md"]);
      expect(strFromU8(withoutReader["Top.md"])).toBe(text);
      expect(Object.keys(unzipSync(withoutImages))).toEqual(
        Object.keys(withoutReader),
      );
    });

    it("never writes a directory entry for the images folder", async () => {
      const files = await build(
        `![a](image:${WEBP_ID}#4x3)`,
        root((r) => [folder(r, "Trips", (t) => [note(t, "Paris")])]),
      );

      expect(Object.keys(files).filter((name) => name.endsWith("_images/"))).toEqual([]);
    });
  });
});
