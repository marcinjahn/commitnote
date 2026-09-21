import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  NotesArchiveError,
  readNotesArchive,
  type ArchiveSkipCounts,
} from "./read-notes-archive";

const NO_SKIPS: ArchiveSkipCounts = {
  unsupported: 0,
  unsafePath: 0,
  reserved: 0,
  invalidName: 0,
  invalidEncoding: 0,
};

function zip(
  files: Record<string, string | Uint8Array>,
  level: 0 | 6 = 0,
): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    zippable[name] = typeof data === "string" ? strToU8(data) : data;
  }
  return zipSync(zippable, { level });
}

function setDeclaredSize(archive: Uint8Array, size: number): Uint8Array {
  const patched = archive.slice();
  const view = new DataView(patched.buffer);
  for (let offset = 0; offset < patched.length - 4; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, size, true);
    }
  }
  return patched;
}

function expectArchiveError(bytes: Uint8Array, kind: string): void {
  let caught: unknown;
  try {
    readNotesArchive(bytes);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NotesArchiveError);
  expect((caught as NotesArchiveError).kind).toBe(kind);
}

describe("readNotesArchive", () => {
  it("reads notes and folders, stripping the .md extension", () => {
    const result = readNotesArchive(
      zip({
        "Journal/": "",
        "Journal/2026/January.md": "Hello",
        "Empty/": "",
        "Shout.MD": "LOUD",
        "Zażółć.md": "gęślą",
      }),
    );

    expect(result.skipped).toEqual(NO_SKIPS);
    expect(result.entries).toEqual(
      expect.arrayContaining([
        { kind: "folder", path: ["Journal"] },
        { kind: "folder", path: ["Empty"] },
        {
          kind: "note",
          path: ["Journal", "2026", "January"],
          content: "Hello",
        },
        { kind: "note", path: ["Shout"], content: "LOUD" },
        { kind: "note", path: ["Zażółć"], content: "gęślą" },
      ]),
    );
    expect(result.entries).toHaveLength(5);
  });

  it("keeps a .md suffix on folder names", () => {
    const result = readNotesArchive(zip({ "Plan.md/": "" }));

    expect(result.entries).toEqual([{ kind: "folder", path: ["Plan.md"] }]);
  });

  it("drops a UTF-8 byte order mark from note content", () => {
    const content = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("text")]);

    const result = readNotesArchive(zip({ "a.md": content }));

    expect(result.entries).toEqual([
      { kind: "note", path: ["a"], content: "text" },
    ]);
  });

  it("counts skipped entries by reason without returning them", () => {
    const result = readNotesArchive(
      zip({
        "image.png": "x",
        "notes.txt": "x",
        "__MACOSX/._a.md": "x",
        ".commitnote/config.json": "{}",
        "nested/.commitnote/a.md": "x",
        "bad.md": new Uint8Array([0xff, 0xfe, 0x00]),
        ".md": "no name",
        "   .md": "blank name",
        [`${"x".repeat(200)}.md`]: "too long",
        "kept.md": "ok",
      }),
    );

    expect(result.entries).toEqual([
      { kind: "note", path: ["kept"], content: "ok" },
    ]);
    expect(result.skipped).toEqual({
      unsupported: 2,
      unsafePath: 0,
      reserved: 3,
      invalidName: 3,
      invalidEncoding: 1,
    });
  });

  it.each([
    "/etc/a.md",
    "C:/a.md",
    "a\\b.md",
    "a//b.md",
    "./a.md",
    "a/../b.md",
    "../a.md",
  ])("skips the unsafe path %s", (zipPath) => {
    const result = readNotesArchive(zip({ [zipPath]: "x" }));

    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual({ ...NO_SKIPS, unsafePath: 1 });
  });

  it("normalizes names to NFC and trims surrounding whitespace", () => {
    const result = readNotesArchive(zip({ " Cafe\u0301 /note .md": "x" }));

    expect(result.entries).toEqual([
      { kind: "note", path: ["Café", "note"], content: "x" },
    ]);
  });

  it("rejects data that is not a zip archive", () => {
    expectArchiveError(strToU8("definitely not a zip file"), "invalidArchive");
  });

  it("returns nothing for an empty archive", () => {
    expect(readNotesArchive(zipSync({}))).toEqual({
      entries: [],
      skipped: NO_SKIPS,
    });
  });

  it("accepts the maximum number of entries", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_ARCHIVE_ENTRIES; i++) files[`f${i}/`] = "";

    expect(readNotesArchive(zip(files)).entries).toHaveLength(
      MAX_ARCHIVE_ENTRIES,
    );
  });

  it("rejects an archive with more entries than the limit", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_ARCHIVE_ENTRIES; i++) files[`f${i}.txt`] = "";

    expectArchiveError(zip(files), "tooManyEntries");
  });

  it("rejects notes whose declared total size exceeds the limit", () => {
    const archive = setDeclaredSize(
      zip({ "a.md": "small" }),
      MAX_ARCHIVE_UNCOMPRESSED_BYTES + 1,
    );

    expectArchiveError(archive, "tooLarge");
  });

  it("ignores the declared size of skipped files", () => {
    const archive = setDeclaredSize(
      zip({ "big.bin": "small" }),
      MAX_ARCHIVE_UNCOMPRESSED_BYTES + 1,
    );

    expect(readNotesArchive(archive).skipped.unsupported).toBe(1);
  });

  it("never inflates a note beyond its declared size", () => {
    const archive = setDeclaredSize(zip({ "a.md": "a".repeat(100_000) }, 6), 10);

    const [entry] = readNotesArchive(archive).entries;

    expect(entry.kind === "note" && entry.content.length).toBeLessThanOrEqual(
      10,
    );
  });
});
