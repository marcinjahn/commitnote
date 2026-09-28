import { describe, expect, it } from "vitest";
import { compareNames, validateName } from "./note-names";

// Explicit escapes avoid depending on how the editor/encoding represents
// accented characters in a source literal.
const E_ACUTE_PRECOMPOSED = "é"; // "é", 2 bytes in UTF-8
const E_ACUTE_COMBINING = "é"; // "e" + combining acute accent

describe("validateName", () => {
  it("rejects a name that is empty once trimmed", () => {
    const result = validateName("  ", []);
    expect(result).toEqual({ ok: false, error: { kind: "empty" } });
  });

  it("rejects a name containing a slash", () => {
    const result = validateName("a/b", []);
    expect(result).toEqual({ ok: false, error: { kind: "containsSlash" } });
  });

  it("rejects '.'", () => {
    const result = validateName(".", []);
    expect(result).toEqual({ ok: false, error: { kind: "dotName" } });
  });

  it("rejects '..'", () => {
    const result = validateName("..", []);
    expect(result).toEqual({ ok: false, error: { kind: "dotName" } });
  });

  it("trims surrounding spaces before checking dotName", () => {
    const result = validateName("  .  ", []);
    expect(result).toEqual({ ok: false, error: { kind: "dotName" } });
  });

  it("accepts a name that is exactly 150 UTF-8 bytes", () => {
    const name = "a".repeat(150);
    const result = validateName(name, []);
    expect(result).toEqual({ ok: true, name });
  });

  it("rejects a name that is 151 UTF-8 bytes, using multi-byte characters", () => {
    // 75 precomposed "é" (2 bytes each) plus one ASCII byte is 151 bytes
    // total, one more than MAX_NAME_BYTES.
    const name = E_ACUTE_PRECOMPOSED.repeat(75) + "a";
    const result = validateName(name, []);
    expect(result).toEqual({
      ok: false,
      error: { kind: "tooLong", maxBytes: 150 },
    });
  });

  it("reports tooLong rather than duplicate when both apply", () => {
    const name = E_ACUTE_PRECOMPOSED.repeat(75) + "a";
    const result = validateName(name, [name]);
    expect(result).toEqual({
      ok: false,
      error: { kind: "tooLong", maxBytes: 150 },
    });
  });

  it("rejects a name equal to an existing sibling", () => {
    const result = validateName("Ideas", ["Projects", "Ideas"]);
    expect(result).toEqual({ ok: false, error: { kind: "duplicate" } });
  });

  it("returns NFC for NFD input", () => {
    const nfd = `caf${E_ACUTE_COMBINING}`;
    const nfc = `caf${E_ACUTE_PRECOMPOSED}`;
    expect(nfd.normalize("NFC")).toBe(nfc);
    expect(nfd).not.toBe(nfc);
    const result = validateName(nfd, []);
    expect(result).toEqual({ ok: true, name: nfc });
  });

  it("trims surrounding spaces", () => {
    const result = validateName("  Notes  ", []);
    expect(result).toEqual({ ok: true, name: "Notes" });
  });

  it("checks empty before containsSlash", () => {
    const result = validateName("   ", ["/"]);
    expect(result).toEqual({ ok: false, error: { kind: "empty" } });
  });

  it("checks containsSlash before dotName", () => {
    const result = validateName("./b", []);
    expect(result).toEqual({ ok: false, error: { kind: "containsSlash" } });
  });
});

describe("compareNames", () => {
  it("orders case-insensitively: apple before Banana", () => {
    expect(compareNames("apple", "Banana")).toBeLessThan(0);
  });

  it("orders case-insensitively: a before B", () => {
    expect(compareNames("a", "B")).toBeLessThan(0);
  });

  it("breaks a case-only tie deterministically and non-zero", () => {
    const first = compareNames("A", "a");
    const second = compareNames("A", "a");
    expect(first).not.toBe(0);
    expect(first).toBe(second);
  });

  it("is antisymmetric for a case-only tie", () => {
    expect(compareNames("a", "A")).toBe(-compareNames("A", "a"));
  });

  it("treats equal names as equal", () => {
    expect(compareNames("Notes", "Notes")).toBe(0);
  });
});
