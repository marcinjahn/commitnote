import { describe, expect, it } from "vitest";
import {
  countSkipped,
  defaultImportFolderName,
  describeAtomicSetup,
  describeImportConflicts,
  describeImportCounts,
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
