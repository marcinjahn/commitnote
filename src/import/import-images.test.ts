import { beforeAll, describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import { decryptImage, type ImagePayload } from "../crypto/image-cipher";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import { buildNotesArchive } from "../export/notes-archive";
import { parseImageReferences } from "../images/image-reference";
import type { ProcessImage } from "../images/prepare-images";
import type { WorkingFolder } from "../sync/working-tree";
import { MAX_IMPORT_IMAGES, prepareImportImages } from "./import-images";
import { type ArchiveImportEntry, readNotesArchive } from "./read-notes-archive";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
});

const processBytes: ProcessImage = async (blob) => ({
  ok: true,
  payload: {
    type: "image/webp",
    width: 40,
    height: 30,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  },
});

function deps(process: ProcessImage = processBytes) {
  return { keyring, process: async () => process };
}

function note(
  content: string,
  archiveFolder: readonly string[] = [],
): ArchiveImportEntry {
  return { kind: "note", path: ["n"], content, archiveFolder };
}

function contentOf(entry: ArchiveImportEntry): string {
  if (entry.kind !== "note") throw new Error("not a note");
  return entry.content;
}

const BYTES_A = Uint8Array.from([1, 2, 3, 4]);
const BYTES_B = Uint8Array.from([9, 8, 7]);

describe("prepareImportImages", () => {
  it("rewrites a reference to an image reference of a pending image", async () => {
    const images = new Map([["pics/a.png", BYTES_A]]);

    const result = await prepareImportImages(
      [note("before ![cat](a.png) after", ["pics"])],
      images,
      deps(),
    );

    expect(result.added).toBe(1);
    expect(result.failed).toBe(0);
    const [pending] = result.images;
    expect(contentOf(result.entries[0])).toBe(
      `before ![cat](image:${pending.imageId}#40x30) after`,
    );
    expect(await decryptImage(keyring, pending.imageId, pending.envelope)).toEqual({
      type: "image/webp",
      width: 40,
      height: 30,
      bytes: BYTES_A,
    });
  });

  it("processes a shared path once and gives each further note a clone", async () => {
    const process = vi.fn(processBytes);

    const result = await prepareImportImages(
      [note("![](a.png)"), note("![](a.png)")],
      new Map([["a.png", BYTES_A]]),
      deps(process),
    );

    expect(process).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(2);
    const [first, second] = result.images;
    expect(second.imageId).not.toBe(first.imageId);
    expect(contentOf(result.entries[0])).toContain(first.imageId);
    expect(contentOf(result.entries[1])).toContain(second.imageId);
    const payload = await decryptImage(keyring, second.imageId, second.envelope);
    expect(payload.bytes).toEqual(BYTES_A);
  });

  it("uses one image for the same path referenced twice in a note", async () => {
    const result = await prepareImportImages(
      [note("![a](a.png) and ![b](./a.png)")],
      new Map([["a.png", BYTES_A]]),
      deps(),
    );

    expect(result.added).toBe(1);
    const ids = parseImageReferences(contentOf(result.entries[0])).map(
      (reference) => reference.imageId,
    );
    expect(ids).toEqual([result.images[0].imageId, result.images[0].imageId]);
  });

  it.each([
    [
      "a rejection",
      async () => ({ ok: false, rejection: { kind: "unsupported" } }) as const,
    ],
    [
      "a thrown error",
      async (): Promise<never> => {
        throw new Error("boom");
      },
    ],
  ])("leaves the reference as written after %s", async (_name, process) => {
    const content = "![x](a.png) ![y](a.png)";

    const result = await prepareImportImages(
      [note(content), note(content)],
      new Map([["a.png", BYTES_A]]),
      deps(process),
    );

    expect(result.images).toEqual([]);
    expect(result.added).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.entries.map(contentOf)).toEqual([content, content]);
  });

  it("leaves the reference as written when the image dimensions are out of range", async () => {
    const content = "![x](a.png)";
    const process: ProcessImage = async () => ({
      ok: true,
      payload: {
        type: "image/webp",
        width: 100000,
        height: 30,
        bytes: BYTES_A,
      },
    });

    const result = await prepareImportImages(
      [note(content)],
      new Map([["a.png", BYTES_A]]),
      deps(process),
    );

    expect(result.images).toEqual([]);
    expect(result.added).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.entries.map(contentOf)).toEqual([content]);
  });

  it("stops at the image cap and leaves later references as written", async () => {
    const archive = new Map<string, Uint8Array>();
    let content = "";
    for (let i = 0; i <= MAX_IMPORT_IMAGES; i++) {
      archive.set(`i${i}.png`, Uint8Array.of(i));
      content += `![](i${i}.png)\n`;
    }

    const result = await prepareImportImages([note(content)], archive, deps());

    expect(result.added).toBe(MAX_IMPORT_IMAGES);
    expect(result.failed).toBe(1);
    const lines = contentOf(result.entries[0]).split("\n");
    expect(lines[MAX_IMPORT_IMAGES - 1]).toMatch(/^!\[\]\(image:/);
    expect(lines[MAX_IMPORT_IMAGES]).toBe(`![](i${MAX_IMPORT_IMAGES}.png)`);
  });

  it("keeps escaped alt text intact", async () => {
    const result = await prepareImportImages(
      [note("![a \\] b \\\\ c](a.png)")],
      new Map([["a.png", BYTES_A]]),
      deps(),
    );

    expect(parseImageReferences(contentOf(result.entries[0]))[0].alt).toBe(
      "a \\] b \\\\ c",
    );
  });

  it("leaves unresolvable references and unrelated entries untouched", async () => {
    const entries: ArchiveImportEntry[] = [
      { kind: "folder", path: ["f"] },
      { kind: "note", path: ["x"], content: "![](a.png)" },
      note("![](https://e.com/a.png) ![](missing.png) ![](/a.png)"),
    ];

    const result = await prepareImportImages(
      entries,
      new Map([["a.png", BYTES_A]]),
      deps(),
    );

    expect(result.entries).toEqual(entries);
    expect(result.entries[0]).toBe(entries[0]);
    expect(result.entries[1]).toBe(entries[1]);
    expect(result.entries[2]).toBe(entries[2]);
    expect(result).toMatchObject({ added: 0, failed: 0 });
  });

  it("does not load the pipeline when there are no archive images", async () => {
    const load = vi.fn(async () => processBytes);
    const entries = [note("![](a.png)")];

    const result = await prepareImportImages(entries, new Map(), {
      keyring,
      process: load,
    });

    expect(load).not.toHaveBeenCalled();
    expect(result.entries).toEqual(entries);
    expect(result.entries[0]).toBe(entries[0]);
  });

  it("imports the images of an exported archive", async () => {
    const idA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const idB = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
    const exported: Record<string, ImagePayload> = {
      [idA]: { type: "image/webp", width: 4, height: 3, bytes: BYTES_A },
      [idB]: { type: "image/webp", width: 2, height: 2, bytes: BYTES_B },
    };
    const texts: Record<string, string> = {
      Top: `top ![one](image:${idA}#4x3)`,
      Nested: `![two](image:${idB}#2x2) and ![one](image:${idA}#4x3)`,
    };
    const rootFolder: WorkingFolder = {
      kind: "folder",
      name: "",
      path: [],
      children: [
        {
          kind: "note",
          name: "Top",
          path: ["Top"],
          syncedPath: ["Top"],
          colorTag: null,
          shared: false,
        },
        {
          kind: "folder",
          name: "Trips",
          path: ["Trips"],
          children: [
            {
              kind: "note",
              name: "Nested",
              path: ["Trips", "Nested"],
              syncedPath: ["Trips", "Nested"],
              colorTag: null,
              shared: false,
            },
          ],
        },
      ],
    };
    const archive = await buildNotesArchive(
      rootFolder,
      async (path: NotePath) => texts[path[path.length - 1]],
      new Date(2026, 8, 30),
      async (imageId) => exported[imageId] ?? null,
    );

    const contents = readNotesArchive(archive);
    const result = await prepareImportImages(
      contents.entries,
      contents.images,
      deps(),
    );

    expect(result.failed).toBe(0);
    const byId = new Map(result.images.map((image) => [image.imageId, image]));
    const expected: Record<string, Uint8Array[]> = {
      Top: [BYTES_A],
      Nested: [BYTES_B, BYTES_A],
    };
    for (const entry of result.entries) {
      if (entry.kind !== "note") continue;
      const references = parseImageReferences(entry.content);
      const bytes = await Promise.all(
        references.map(async ({ imageId }) => {
          const image = byId.get(imageId)!;
          return (await decryptImage(keyring, imageId, image.envelope)).bytes;
        }),
      );
      expect(bytes).toEqual(expected[entry.path[entry.path.length - 1]]);
    }
    expect(result.added).toBe(3);
  });
});

