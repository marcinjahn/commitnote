import { describe, expect, it } from "vitest";
import { TRASH_RETENTION_MS } from "../../format/v1";
import {
  describeDaysLeft,
  describeEmptyTrash,
  describeOriginalFolder,
  describeRevokeFailed,
  describeSharesRevokedOnDelete,
  describeSharesRevokedOnTrash,
  describeTrashedShares,
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

  it("warns that deleting from the trash revokes leftover links", () => {
    expect(describeSharesRevokedOnDelete(1)).toBe(
      "1 active share link to a note in the trash will be revoked too.",
    );
    expect(describeSharesRevokedOnDelete(3)).toBe(
      "3 active share links to notes in the trash will be revoked too.",
    );
  });

  it("points leftover links in the trash to where they can be revoked", () => {
    expect(describeTrashedShares(1)).toMatch(/^1 active share link still points to a note/);
    expect(describeTrashedShares(2)).toMatch(/^2 active share links still point to notes/);
  });
});

describe("describeRevokeFailed", () => {
  it("says nothing was trashed or deleted and how many links went", () => {
    expect(describeRevokeFailed("Offline.", 0, "trash")).toBe(
      "Offline. Nothing was moved to the trash.",
    );
    expect(describeRevokeFailed("Offline.", 1, "delete")).toBe(
      "Offline. Nothing was deleted. 1 link was already revoked.",
    );
    expect(describeRevokeFailed("Offline.", 2, "trash")).toBe(
      "Offline. Nothing was moved to the trash. 2 links were already revoked.",
    );
  });
});
