import { describe, expect, it } from "vitest";
import type { EngineNotice } from "../../sync/sync-engine";
import { describeNotice } from "./notice-messages";

function merge(notice: Extract<EngineNotice, { kind: "merge" }>["notice"]): EngineNotice {
  return { id: 1, kind: "merge", notice };
}

describe("describeNotice", () => {
  it("describes an edited merge restored after the note disappeared", () => {
    expect(
      describeNotice({ id: 1, kind: "edited-merge-restored", path: ["a", "b"] }),
    ).toBe(
      "“a / b” was moved or deleted on another device while you were editing the merged text. Your merged text was saved at its original location — check it for parts you hadn't resolved yet.",
    );
  });

  it("describes restored edits", () => {
    expect(describeNotice(merge({ kind: "edit-restored", path: ["a", "b"] }))).toBe(
      "“a / b” was moved or deleted on another device. Your edits were saved at its original location.",
    );
  });

  it("describes a skipped delete", () => {
    expect(
      describeNotice(merge({ kind: "delete-skipped", path: ["a"], target: "folder" })),
    ).toBe("“a” was changed on another device, so it was not deleted.");
  });

  it("describes a rename whose target is taken", () => {
    expect(
      describeNotice(
        merge({ kind: "rename-skipped", from: ["a"], to: ["b", "c"], reason: "target-exists" }),
      ),
    ).toBe(
      "Couldn't rename or move “a” to “b / c”: that name is already taken.",
    );
  });

  it("describes a rename whose source is missing", () => {
    expect(
      describeNotice(
        merge({ kind: "rename-skipped", from: ["a"], to: ["b"], reason: "source-missing" }),
      ),
    ).toBe("Couldn't rename or move “a”: it no longer exists.");
  });

  it("describes a relocated item", () => {
    expect(
      describeNotice(
        merge({ kind: "relocated", from: ["a"], to: ["a (conflict)"], target: "note" }),
      ),
    ).toBe(
      "“a” was saved as “a (conflict)” because another device created an item with the same name.",
    );
  });

  it("describes a conflict", () => {
    expect(describeNotice({ id: 2, kind: "conflict", path: ["x", "y"] })).toBe(
      "“x / y” was changed on another device too. Open it to resolve the conflict.",
    );
  });

  it.each([
    [{ kind: "rename-note", from: ["a", "n"], to: ["b"] }],
    [{ kind: "rename-folder", from: ["a", "n"], to: ["b"] }],
  ] as const)("describes a dropped %j", (change) => {
    expect(describeNotice({ id: 3, kind: "dropped", change })).toBe(
      "Couldn't rename or move “a / n”: it changed on another device.",
    );
  });

  it.each([
    [{ kind: "delete-note", path: ["a"] }],
    [{ kind: "delete-folder", path: ["a"] }],
  ] as const)("describes a dropped %j", (change) => {
    expect(describeNotice({ id: 4, kind: "dropped", change })).toBe(
      "“a” was not deleted because it changed on another device.",
    );
  });

  it.each([
    [{ kind: "create-note", path: ["a"], content: "" }],
    [{ kind: "update-note", path: ["a"], content: "" }],
    [{ kind: "create-folder", path: ["a"] }],
  ] as const)("describes a dropped %j", (change) => {
    expect(describeNotice({ id: 5, kind: "dropped", change })).toBe(
      "A change to “a” couldn't be saved because it changed on another device.",
    );
  });
});
