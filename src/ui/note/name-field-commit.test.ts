import { describe, expect, it } from "vitest";
import { describeNameError } from "../dialogs/name-messages";
import { decideNameCommit } from "./name-field-commit";

const base = {
  currentName: "Groceries",
  edited: "Groceries",
  siblingNames: ["Work", "Ideas"],
  conflicted: false,
};

describe("decideNameCommit", () => {
  it("does nothing while the note has a conflict", () => {
    expect(
      decideNameCommit({ ...base, edited: "Renamed", conflicted: true }),
    ).toEqual({ kind: "noop" });
    expect(
      decideNameCommit({ ...base, edited: "", conflicted: true }),
    ).toEqual({ kind: "noop" });
  });

  it("restores the current name when the field is emptied", () => {
    expect(decideNameCommit({ ...base, edited: "" })).toEqual({
      kind: "restore",
    });
  });

  it("restores the current name for a whitespace-only value", () => {
    expect(decideNameCommit({ ...base, edited: "   \t " })).toEqual({
      kind: "restore",
    });
  });

  it("does nothing for an empty value on a draft", () => {
    expect(
      decideNameCommit({ ...base, currentName: null, edited: "  " }),
    ).toEqual({ kind: "noop" });
  });

  it("reports the message for an invalid name", () => {
    expect(decideNameCommit({ ...base, edited: "a/b" })).toEqual({
      kind: "error",
      message: describeNameError({ kind: "containsSlash" }),
    });
  });

  it("reports a duplicate sibling name", () => {
    expect(decideNameCommit({ ...base, edited: "Work" })).toEqual({
      kind: "error",
      message: describeNameError({ kind: "duplicate" }),
    });
  });

  it("reports a name that is too long", () => {
    expect(decideNameCommit({ ...base, edited: "a".repeat(151) })).toEqual({
      kind: "error",
      message: describeNameError({ kind: "tooLong", maxBytes: 150 }),
    });
  });

  it("does nothing when the name is unchanged", () => {
    expect(decideNameCommit(base)).toEqual({ kind: "noop" });
  });

  it("does nothing when only surrounding whitespace differs", () => {
    expect(decideNameCommit({ ...base, edited: "  Groceries  " })).toEqual({
      kind: "noop",
    });
  });

  it("commits the trimmed, NFC-normalised name", () => {
    expect(
      decideNameCommit({ ...base, edited: "  Café  " }),
    ).toEqual({ kind: "commit", name: "Café" });
  });

  it("commits a valid name for a draft", () => {
    expect(
      decideNameCommit({ ...base, currentName: null, edited: "New" }),
    ).toEqual({ kind: "commit", name: "New" });
  });
});
