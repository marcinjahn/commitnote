import { expect, it } from "vitest";
import { exportFileName } from "./export-file-name";

it("names the archive after the zero-padded local date", () => {
  expect(exportFileName(new Date(2026, 2, 4, 23, 59))).toBe(
    "commitnote-export-2026-03-04.zip",
  );
});
