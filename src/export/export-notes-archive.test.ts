import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotePath } from "../changes/change";
import type { ImagePayload } from "../crypto/image-cipher";
import type { ReadImagePayload } from "../images/image-resolver";
import type { NotesSnapshot } from "../sync/sync-engine";
import type { WorkingTree } from "../sync/working-tree";
import { exportNotesArchive } from "./export-notes-archive";

const IMAGE_ID = "a".repeat(26);
const BYTES = new Uint8Array([1, 2, 3, 250]);
const PAYLOAD: ImagePayload = {
  type: "image/webp",
  width: 4,
  height: 3,
  bytes: BYTES,
};

function snapshot(): NotesSnapshot {
  const path: NotePath = ["Trip"];
  const tree = {
    root: {
      kind: "folder",
      name: "",
      path: [],
      children: [
        {
          kind: "note",
          name: "Trip",
          path,
          syncedPath: path,
          colorTag: null,
          shared: false,
        },
      ],
    },
  } as unknown as WorkingTree;
  return { tree, readNote: async () => `![](image:${IMAGE_ID}#4x3)` };
}

async function exportFiles(readImage?: ReadImagePayload) {
  let delivered: File | null = null;
  await exportNotesArchive(snapshot(), {
    readImage,
    download: async (file) => {
      delivered = file;
      return "downloaded";
    },
  });
  expect(delivered).not.toBeNull();
  return unzipSync(new Uint8Array(await (delivered as unknown as File).arrayBuffer()));
}

describe("exportNotesArchive", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes images into the archive when an image reader is given", async () => {
    const files = await exportFiles(async (id) => (id === IMAGE_ID ? PAYLOAD : null));

    expect(files[`_images/${IMAGE_ID}.webp`]).toEqual(BYTES);
    expect(strFromU8(files["Trip.md"])).toBe(`![](_images/${IMAGE_ID}.webp)`);
  });

  it("leaves notes untouched without an image reader", async () => {
    const files = await exportFiles();

    expect(Object.keys(files)).toEqual(["Trip.md"]);
    expect(strFromU8(files["Trip.md"])).toBe(`![](image:${IMAGE_ID}#4x3)`);
  });
});
