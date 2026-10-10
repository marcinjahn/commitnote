import { describe, expect, it } from "vitest";
import { MAX_SHARE_LABEL_LENGTH, normalizeShareLabel } from "./share-label";

describe("normalizeShareLabel", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeShareLabel("  Team link \n")).toEqual({
      ok: true,
      label: "Team link",
    });
  });

  it("normalizes to NFC", () => {
    const result = normalizeShareLabel("é");
    expect(result).toEqual({ ok: true, label: "é" });
  });

  it("maps empty and whitespace-only input to null", () => {
    expect(normalizeShareLabel("")).toEqual({ ok: true, label: null });
    expect(normalizeShareLabel(" \t\n ")).toEqual({ ok: true, label: null });
  });

  it("accepts exactly the maximum length and rejects one more", () => {
    expect(normalizeShareLabel("a".repeat(MAX_SHARE_LABEL_LENGTH))).toEqual({
      ok: true,
      label: "a".repeat(MAX_SHARE_LABEL_LENGTH),
    });
    expect(normalizeShareLabel("a".repeat(MAX_SHARE_LABEL_LENGTH + 1))).toEqual(
      { ok: false, error: "tooLong" },
    );
  });

  it("measures the length after trimming", () => {
    const padded = ` ${"a".repeat(MAX_SHARE_LABEL_LENGTH)} `;
    expect(normalizeShareLabel(padded)).toEqual({
      ok: true,
      label: "a".repeat(MAX_SHARE_LABEL_LENGTH),
    });
  });
});
