import { describe, expect, it } from "vitest";
import {
  confirmEarlyDraftName,
  emptyEarlyDraft,
  isUntouched,
  parseEarlyDraft,
  planEarlyDraftHandoff,
  withEarlyDraftBody,
  withEarlyDraftName,
  type EarlyDraft,
} from "./early-draft";

const at = (n: number) => ({ anchor: n, head: n });

function draft(partial: Partial<EarlyDraft>): EarlyDraft {
  return { ...emptyEarlyDraft(), ...partial };
}

describe("emptyEarlyDraft", () => {
  it("is empty and focuses the name by default", () => {
    expect(emptyEarlyDraft()).toEqual({
      name: "",
      body: "",
      focus: "name",
      selection: at(0),
      nameConfirmed: false,
      contentStartedAt: null,
    });
  });

  it("can focus the body", () => {
    expect(emptyEarlyDraft("body").focus).toBe("body");
  });
});

describe("isUntouched", () => {
  it.each<[string, Partial<EarlyDraft>, boolean]>([
    ["empty", {}, true],
    ["name only", { name: "a" }, false],
    ["body only", { body: "a" }, false],
    ["both", { name: "a", body: "b" }, false],
    ["whitespace name", { name: " " }, false],
  ])("%s", (_label, partial, expected) => {
    expect(isUntouched(draft(partial))).toBe(expected);
  });
});

describe("withEarlyDraftName", () => {
  it("sets name, selection and focus", () => {
    expect(
      withEarlyDraftName(draft({ focus: "body" }), "Ab", at(2)),
    ).toMatchObject({ name: "Ab", focus: "name", selection: at(2) });
  });

  it("resets confirmation when the name changes", () => {
    const result = withEarlyDraftName(
      draft({ name: "Ab", nameConfirmed: true }),
      "Abc",
      at(3),
    );
    expect(result.nameConfirmed).toBe(false);
  });

  it("keeps confirmation when only the selection changes", () => {
    const result = withEarlyDraftName(
      draft({ name: "Ab", nameConfirmed: true }),
      "Ab",
      at(1),
    );
    expect(result.nameConfirmed).toBe(true);
  });
});

describe("confirmEarlyDraftName", () => {
  it("confirms and moves to the end of the body", () => {
    expect(
      confirmEarlyDraftName(draft({ name: "Ab", body: "hello" })),
    ).toMatchObject({
      nameConfirmed: true,
      focus: "body",
      selection: at(5),
    });
  });
});

describe("withEarlyDraftBody", () => {
  it.each<[string, number | null, string, number | null]>([
    ["empty to non-empty starts the clock", null, "a", 100],
    ["non-empty keeps the clock", 50, "ab", 50],
    ["becoming empty clears the clock", 50, "", null],
    ["empty to empty stays null", null, "", null],
  ])("%s", (_label, before, next, expected) => {
    const start = draft({
      body: before === null ? "" : "x",
      contentStartedAt: before,
    });
    const result = withEarlyDraftBody(start, next, at(next.length), 100);
    expect(result.contentStartedAt).toBe(expected);
    expect(result).toMatchObject({
      body: next,
      focus: "body",
      selection: at(next.length),
    });
  });
});

describe("planEarlyDraftHandoff", () => {
  it.each<[string, Partial<EarlyDraft>, unknown]>([
    ["untouched", {}, { kind: "untouched" }],
    [
      "content with name",
      { name: "N", body: "b", contentStartedAt: 9 },
      { kind: "content", name: "N", body: "b", contentStartedAt: 9 },
    ],
    [
      "content without name",
      { body: "b", contentStartedAt: 9 },
      { kind: "content", name: "", body: "b", contentStartedAt: 9 },
    ],
    [
      "content wins over confirmation",
      { name: "N", body: "b", nameConfirmed: true, contentStartedAt: 9 },
      { kind: "content", name: "N", body: "b", contentStartedAt: 9 },
    ],
    [
      "confirmed name",
      { name: "N", nameConfirmed: true },
      { kind: "confirmName", name: "N" },
    ],
    ["unconfirmed name", { name: "N" }, { kind: "name", name: "N" }],
    [
      "confirmed but empty name is not a confirmation",
      { name: "", nameConfirmed: true },
      { kind: "untouched" },
    ],
  ])("%s", (_label, partial, expected) => {
    expect(planEarlyDraftHandoff(draft(partial))).toEqual(expected);
  });
});

describe("parseEarlyDraft", () => {
  const valid = {
    name: "N",
    body: "b",
    focus: "body",
    selection: { anchor: 1, head: 1 },
    nameConfirmed: true,
    contentStartedAt: 123,
  };

  it("accepts a valid draft", () => {
    expect(parseEarlyDraft(valid)).toEqual(valid);
  });

  it("accepts a null contentStartedAt", () => {
    expect(parseEarlyDraft({ ...valid, contentStartedAt: null })).toEqual({
      ...valid,
      contentStartedAt: null,
    });
  });

  it("drops unknown fields", () => {
    expect(parseEarlyDraft({ ...valid, extra: 1 })).toEqual(valid);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["string", "x"],
    ["array", []],
    ["missing name", { ...valid, name: undefined }],
    ["numeric body", { ...valid, body: 1 }],
    ["bad focus", { ...valid, focus: "title" }],
    ["missing selection", { ...valid, selection: undefined }],
    ["null selection", { ...valid, selection: null }],
    ["string anchor", { ...valid, selection: { anchor: "1", head: 1 } }],
    ["negative head", { ...valid, selection: { anchor: 1, head: -1 } }],
    ["fractional anchor", { ...valid, selection: { anchor: 0.5, head: 1 } }],
    ["non-boolean confirmed", { ...valid, nameConfirmed: 1 }],
    ["undefined contentStartedAt", { ...valid, contentStartedAt: undefined }],
    ["string contentStartedAt", { ...valid, contentStartedAt: "1" }],
    ["NaN contentStartedAt", { ...valid, contentStartedAt: Number.NaN }],
  ])("rejects %s", (_label, value) => {
    expect(parseEarlyDraft(value)).toBeNull();
  });
});
