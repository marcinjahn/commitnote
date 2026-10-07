import { describe, expect, it } from "vitest";
import type { ShareEntry, ShareSource } from "../share/share-index";
import type { NoteVersion } from "./note-history";
import { isGroupShared, sharedVersionShas } from "./shared-versions";

function share(source: ShareSource | null): ShareEntry {
  return { source } as ShareEntry;
}

function source(commit: string): ShareSource {
  return { commit, storedPath: "n", blobSha: "blob" };
}

function version(sha: string): NoteVersion {
  return { sha, committedAt: 0, storedPath: "n", name: "Note", events: [] };
}

describe("sharedVersionShas", () => {
  it("collects the commit of every share with a source", () => {
    expect(
      sharedVersionShas([share(source("a")), share(source("b"))]),
    ).toEqual(new Set(["a", "b"]));
  });

  it("ignores shares without a source", () => {
    expect(sharedVersionShas([share(null), share(source("a"))])).toEqual(
      new Set(["a"]),
    );
  });

  it("is empty without shares", () => {
    expect(sharedVersionShas([]).size).toBe(0);
  });
});

describe("isGroupShared", () => {
  it("is true when any version is shared", () => {
    expect(
      isGroupShared([version("c"), version("b"), version("a")], new Set(["b"])),
    ).toBe(true);
  });

  it("is false when no version is shared", () => {
    expect(isGroupShared([version("c"), version("b")], new Set(["a"]))).toBe(
      false,
    );
  });
});
