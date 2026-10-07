import { describe, expect, it } from "vitest";
import {
  countSkipped,
  defaultImportFolderName,
  describeAtomicSetup,
  describeImportConflicts,
  describeDropSkipped,
  describeFileDropDone,
  describeImportCounts,
  describeNothingDropped,
  describeSkipped,
  FALLBACK_IMPORT_FOLDER_NAME,
} from "./import-messages";

describe("import messages", () => {
  it("derives the new folder name from the archive file name", () => {
    expect(defaultImportFolderName("commitnote-export-2026-10-01.zip")).toBe(
      "commitnote-export-2026-10-01",
    );
    expect(defaultImportFolderName("Notes.ZIP")).toBe("Notes");
    expect(defaultImportFolderName(".zip")).toBe(FALLBACK_IMPORT_FOLDER_NAME);
    expect(defaultImportFolderName("a/b.zip")).toBe(FALLBACK_IMPORT_FOLDER_NAME);
  });

  it("counts and describes what is imported and skipped", () => {
    expect(describeImportCounts(1, 0)).toBe("1 note and 0 folders");
    expect(describeImportCounts(3, 1)).toBe("3 notes and 1 folder");
    expect(
      countSkipped({
        unsupported: 2,
        unsafePath: 1,
        reserved: 1,
        invalidName: 1,
        invalidEncoding: 1,
      }),
    ).toBe(6);
    expect(describeSkipped(0)).toBeNull();
    expect(describeSkipped(1)).toMatch(/^1 file will be skipped/);
    expect(describeSkipped(2)).toMatch(/^2 files will be skipped/);
  });

  it("describes name conflicts with their count", () => {
    expect(describeImportConflicts(1)).toMatch(/^1 imported item has/);
    expect(describeImportConflicts(4)).toMatch(/^4 imported items have/);
  });

  it("explains the fast-forward merge setting depending on who can change it", () => {
    expect(describeAtomicSetup("GitLab", true)).toMatch(
      /GitLab project to use the “Fast-forward merge” method\. commitnote can switch/,
    );
    expect(describeAtomicSetup("GitLab", false)).toMatch(/Ask a project Maintainer/);
  });
});

describe("file drop messages", () => {
  const none = {
    folders: 0,
    unsupported: 0,
    invalidEncoding: 0,
    invalidName: 0,
    tooLarge: 0,
    tooMany: 0,
  };

  it("says nothing when nothing was skipped", () => {
    expect(describeDropSkipped(none)).toBeNull();
  });

  it("lists only non-zero reasons in a fixed order", () => {
    expect(describeDropSkipped({ ...none, unsupported: 2, tooLarge: 1 })).toBe(
      "Skipped 3 files: 2 not .md, .markdown or .txt, 1 over 1 MiB.",
    );
    expect(describeDropSkipped({ ...none, folders: 1 })).toBe(
      "Skipped 1 file: 1 folder.",
    );
    expect(
      describeDropSkipped({
        folders: 2,
        unsupported: 1,
        invalidEncoding: 1,
        invalidName: 1,
        tooLarge: 1,
        tooMany: 5,
      }),
    ).toBe(
      "Skipped 11 files: 2 folders, 1 not .md, .markdown or .txt, 1 not UTF-8 text, 1 with an invalid name, 1 over 1 MiB, 5 over the 100-file limit.",
    );
  });

  it("describes a finished drop", () => {
    expect(describeFileDropDone(1, none)).toBe("Imported 1 note.");
    expect(describeFileDropDone(2, { ...none, invalidName: 1 })).toBe(
      "Imported 2 notes. Skipped 1 file: 1 with an invalid name.",
    );
  });

  it("describes a drop that imported nothing", () => {
    expect(describeNothingDropped(none)).toBe("No notes imported.");
    expect(describeNothingDropped({ ...none, tooMany: 3 })).toBe(
      "No notes imported. Skipped 3 files: 3 over the 100-file limit.",
    );
  });
});
