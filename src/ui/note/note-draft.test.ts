import { describe, expect, it } from "vitest";
import { describeNameError } from "../dialogs/name-messages";
import { resolveNoteDraft, type NoteDraft } from "./note-draft";

const parent = ["Projects"];
const now = new Date(2026, 0, 5, 7, 3, 9);
const siblings = ["Existing"];

function draft(name: string): NoteDraft {
  return { parent, name };
}

describe("resolveNoteDraft", () => {
  describe("nameConfirmed", () => {
    const event = { kind: "nameConfirmed" } as const;

    it("keeps the draft when the name is empty", () => {
      expect(resolveNoteDraft(draft("  "), event, siblings)).toEqual({
        kind: "none",
      });
    });

    it("shows the error for an invalid name", () => {
      expect(resolveNoteDraft(draft("Existing"), event, siblings)).toEqual({
        kind: "showError",
        message: describeNameError({ kind: "duplicate" }),
      });
    });

    it("creates the note with the validated name", () => {
      expect(resolveNoteDraft(draft("  Fresh "), event, siblings)).toEqual({
        kind: "create",
        parent,
        name: "Fresh",
      });
    });
  });

  describe("contentChanged", () => {
    const event = { kind: "contentChanged", content: "hello", now } as const;

    it("creates with the typed name when it is valid", () => {
      expect(resolveNoteDraft(draft("Fresh"), event, siblings)).toEqual({
        kind: "createWithContent",
        parent,
        name: "Fresh",
        content: "hello",
        fieldError: null,
      });
    });

    it("uses the auto name when the name is empty", () => {
      expect(resolveNoteDraft(draft(""), event, siblings)).toEqual({
        kind: "createWithContent",
        parent,
        name: "2026-01-05 07:03:09",
        content: "hello",
        fieldError: null,
      });
    });

    it("uses the auto name and reports the error when the name is invalid", () => {
      expect(resolveNoteDraft(draft("a/b"), event, siblings)).toEqual({
        kind: "createWithContent",
        parent,
        name: "2026-01-05 07:03:09",
        content: "hello",
        fieldError: describeNameError({ kind: "containsSlash" }),
      });
    });

    it("avoids sibling collisions in the auto name", () => {
      const taken = ["2026-01-05 07:03:09"];
      expect(resolveNoteDraft(draft(""), event, taken)).toMatchObject({
        name: "2026-01-05 07:03:09 (2)",
      });
    });
  });

  describe("left", () => {
    it("discards the draft", () => {
      expect(
        resolveNoteDraft(draft(""), { kind: "left" }, siblings),
      ).toEqual({ kind: "discard" });
    });
  });
});
