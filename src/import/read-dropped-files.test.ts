import { describe, expect, it } from "vitest";
import {
  countDropSkipped,
  MAX_DROPPED_FILE_BYTES,
  MAX_DROPPED_FILES,
  readDroppedFiles,
  type DroppedFile,
} from "./read-dropped-files";

function file(
  name: string,
  content: string | Uint8Array = "text",
  overrides: Partial<Pick<DroppedFile, "size" | "directory">> = {},
): DroppedFile {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: overrides.size ?? bytes.byteLength,
    directory: overrides.directory ?? false,
    arrayBuffer: async () =>
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
  };
}

describe("readDroppedFiles", () => {
  it("turns note files into top-level note entries in input order", async () => {
    const { entries, skipped } = await readDroppedFiles([
      file("b.md", "B"),
      file("a.txt", "A"),
    ]);
    expect(entries).toEqual([
      { kind: "note", path: ["b"], content: "B" },
      { kind: "note", path: ["a"], content: "A" },
    ]);
    expect(countDropSkipped(skipped)).toBe(0);
  });

  it("matches extensions case-insensitively and strips only the last one", async () => {
    const { entries } = await readDroppedFiles([
      file("NOTE.MD"),
      file("a.Markdown"),
      file("a.b.md"),
    ]);
    expect(entries.map((e) => e.path)).toEqual([["NOTE"], ["a"], ["a.b"]]);
  });

  it("counts folders without counting them toward the limit", async () => {
    const folders = Array.from({ length: 5 }, (_, i) =>
      file(`dir${i}`, "", { directory: true }),
    );
    const notes = Array.from({ length: MAX_DROPPED_FILES }, (_, i) =>
      file(`n${i}.md`),
    );
    const { entries, skipped } = await readDroppedFiles([...folders, ...notes]);
    expect(entries).toHaveLength(MAX_DROPPED_FILES);
    expect(skipped.folders).toBe(5);
    expect(skipped.tooMany).toBe(0);
  });

  it("skips files beyond the limit without reading them", async () => {
    let reads = 0;
    const files = Array.from({ length: MAX_DROPPED_FILES + 2 }, (_, i) => {
      const f = file(`n${i}.md`);
      return {
        ...f,
        arrayBuffer: () => {
          reads++;
          return f.arrayBuffer();
        },
      };
    });
    const { entries, skipped } = await readDroppedFiles(files);
    expect(entries).toHaveLength(MAX_DROPPED_FILES);
    expect(skipped.tooMany).toBe(2);
    expect(reads).toBe(MAX_DROPPED_FILES);
  });

  it("counts unsupported files toward the limit", async () => {
    const files = [
      ...Array.from({ length: MAX_DROPPED_FILES }, (_, i) => file(`x${i}.png`)),
      file("late.md"),
    ];
    const { entries, skipped } = await readDroppedFiles(files);
    expect(entries).toEqual([]);
    expect(skipped.unsupported).toBe(MAX_DROPPED_FILES);
    expect(skipped.tooMany).toBe(1);
  });

  it("skips unsupported extensions", async () => {
    const { entries, skipped } = await readDroppedFiles([
      file("a.png"),
      file("noext"),
      file("a.md.bak"),
    ]);
    expect(entries).toEqual([]);
    expect(skipped.unsupported).toBe(3);
  });

  it("accepts exactly 1 MiB and rejects one byte more without reading it", async () => {
    const atLimit = file("ok.md", "x".repeat(MAX_DROPPED_FILE_BYTES));
    let read = false;
    const over = {
      ...file("big.md"),
      size: MAX_DROPPED_FILE_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    };
    const { entries, skipped } = await readDroppedFiles([atLimit, over]);
    expect(entries.map((e) => e.path)).toEqual([["ok"]]);
    expect(skipped.tooLarge).toBe(1);
    expect(read).toBe(false);
  });

  it("drops a UTF-8 BOM", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    const { entries } = await readDroppedFiles([file("a.md", bytes)]);
    expect(entries[0].content).toBe("hi");
  });

  it("skips content that is not UTF-8", async () => {
    const { entries, skipped } = await readDroppedFiles([
      file("bad.md", new Uint8Array([0xff, 0xfe, 0x00])),
      file("good.md", "ok"),
    ]);
    expect(entries.map((e) => e.path)).toEqual([["good"]]);
    expect(skipped.invalidEncoding).toBe(1);
  });

  it("skips files whose name without extension is invalid", async () => {
    const { entries, skipped } = await readDroppedFiles([
      file(".md"),
      file("  .txt"),
      file("..md"),
      file("a/b.md"),
    ]);
    expect(entries).toEqual([]);
    expect(skipped.invalidName).toBe(4);
  });

  it("applies the first matching rule", async () => {
    const { skipped } = await readDroppedFiles([
      file("a.png", "x", { size: MAX_DROPPED_FILE_BYTES + 1 }),
      file("big.md", new Uint8Array([0xff]), {
        size: MAX_DROPPED_FILE_BYTES + 1,
      }),
      file("bad.md", new Uint8Array([0xff])),
    ]);
    expect(skipped).toEqual({
      folders: 0,
      unsupported: 1,
      invalidEncoding: 1,
      invalidName: 0,
      tooLarge: 1,
      tooMany: 0,
    });
  });
});

describe("countDropSkipped", () => {
  it("sums every reason", () => {
    expect(
      countDropSkipped({
        folders: 1,
        unsupported: 2,
        invalidEncoding: 3,
        invalidName: 4,
        tooLarge: 5,
        tooMany: 6,
      }),
    ).toBe(21);
  });
});
