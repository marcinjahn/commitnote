import { describe, expect, it } from "vitest";
import type { EngineNotice } from "../../sync/sync-engine";
import { describeNotice, noticeTone, toneLabel } from "./notice-messages";

function merge(notice: Extract<EngineNotice, { kind: "merge" }>["notice"]): EngineNotice {
  return { id: 1, kind: "merge", notice };
}

describe("describeNotice", () => {
  it("describes a dropped set-settings change", () => {
    expect(
      describeNotice({
        id: 1,
        kind: "dropped",
        change: { kind: "set-settings", values: { theme: "dark" } },
      } as EngineNotice),
    ).toBe(
      "Some settings couldn't be saved because they changed on another device.",
    );
  });

  it("describes a dropped share change", () => {
    for (const change of [
      { kind: "remove-share", id: "a" },
      { kind: "add-share", entry: {} },
      { kind: "update-share", entry: {} },
    ]) {
      expect(
        describeNotice({ id: 1, kind: "dropped", change } as EngineNotice),
      ).toBe("A change to your shared links couldn't be saved.");
    }
  });

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

  it("describes a skipped restore", () => {
    expect(
      describeNotice(merge({ kind: "restore-skipped", path: ["a", "b"], target: "note" })),
    ).toBe("Couldn't restore “a / b”: it is no longer in the trash.");
  });

  it("describes a dropped restore", () => {
    expect(
      describeNotice({
        id: 6,
        kind: "dropped",
        change: { kind: "restore-trash", entryId: "e", subPath: [], target: "note", to: ["a"] },
      }),
    ).toBe("Couldn't restore “a” from the trash: it changed on another device.");
  });

  it("describes a dropped purge without naming anything", () => {
    expect(
      describeNotice({ id: 7, kind: "dropped", change: { kind: "purge-trash", entryIds: ["e"] } }),
    ).toBe(
      "Some items couldn't be permanently deleted from the trash because it changed on another device.",
    );
  });
});

describe("noticeTone", () => {
  it("warns about conflicts and dropped changes", () => {
    expect(
      noticeTone({ id: 1, kind: "conflict", path: ["a"] } as EngineNotice),
    ).toBe("warning");
    expect(
      noticeTone({
        id: 2,
        kind: "dropped",
        change: { kind: "purge-trash", entryIds: ["e"] },
      }),
    ).toBe("warning");
  });

  it("treats merge outcomes as info", () => {
    expect(
      noticeTone(merge({ kind: "delete-skipped", path: ["a"], target: "note" })),
    ).toBe("info");
    expect(
      noticeTone({ id: 3, kind: "edited-merge-restored", path: ["a"] } as EngineNotice),
    ).toBe("info");
  });
});

describe("toneLabel", () => {
  it("capitalises the tone", () => {
    expect(toneLabel("success")).toBe("Success");
    expect(toneLabel("info")).toBe("Info");
    expect(toneLabel("warning")).toBe("Warning");
    expect(toneLabel("error")).toBe("Error");
  });
});
