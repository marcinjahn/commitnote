import { describe, expect, it } from "vitest";
import { TRASH_RETENTION_MS } from "../../format/v1";
import {
  describeDaysLeft,
  describeEmptyTrash,
  describeOriginalFolder,
  describeRevokeFailed,
  describeSharesRevokedOnTrash,
} from "./trash-messages";

const DAY = 24 * 60 * 60 * 1000;

describe("describeDaysLeft", () => {
  it("rounds partial days up", () => {
    expect(describeDaysLeft(0, DAY)).toBe("29 days left");
    expect(describeDaysLeft(0, DAY + 1)).toBe("29 days left");
    expect(describeDaysLeft(0, 0)).toBe("30 days left");
  });

  it("uses the singular for the last day", () => {
    expect(describeDaysLeft(0, TRASH_RETENTION_MS - 1000)).toBe("1 day left");
  });

  it("never reports less than a day for an item still shown", () => {
    expect(describeDaysLeft(0, TRASH_RETENTION_MS)).toBe("1 day left");
  });
});

describe("describeEmptyTrash", () => {
  it("pluralizes", () => {
    expect(describeEmptyTrash(1)).toBe("1 item will be deleted permanently.");
    expect(describeEmptyTrash(3)).toBe("3 items will be deleted permanently.");
  });
});

describe("describeOriginalFolder", () => {
  it("names the top level and nested folders", () => {
    expect(describeOriginalFolder(["a"])).toBe("Notes (top level)");
    expect(describeOriginalFolder(["x", "y", "a"])).toBe("x / y");
  });
});

describe("share warnings", () => {
  it("warns that trashing a note revokes its links", () => {
    expect(describeSharesRevokedOnTrash(1, "note")).toBe(
      "This note has 1 active share link. Moving it to the trash revokes it permanently. Restoring it won't bring it back.",
    );
    expect(describeSharesRevokedOnTrash(2, "folder")).toBe(
      "Notes in this folder have 2 active share links. Moving it to the trash revokes them permanently. Restoring it won't bring them back.",
    );
  });
});

describe("describeRevokeFailed", () => {
  it("says nothing was trashed and how many links went", () => {
    expect(describeRevokeFailed("Offline.", 0)).toBe(
      "Offline. Nothing was moved to the trash.",
    );
    expect(describeRevokeFailed("Offline.", 1)).toBe(
      "Offline. Nothing was moved to the trash. 1 link was already revoked.",
    );
    expect(describeRevokeFailed("Offline.", 2)).toBe(
      "Offline. Nothing was moved to the trash. 2 links were already revoked.",
    );
  });
});
