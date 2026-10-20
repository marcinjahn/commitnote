import { describe, expect, it } from "vitest";
import { atob, btoa } from "./base64-globals";

describe("btoa", () => {
  it.each(["", "f", "fo", "foo", "foob", "\u0000ÿ\u0080abc"])(
    "matches the platform for %j",
    (text) => {
      expect(btoa(text)).toBe(globalThis.btoa(text));
    },
  );

  it("throws InvalidCharacterError outside Latin-1", () => {
    expect(() => btoa("€")).toThrow(expect.objectContaining({ name: "InvalidCharacterError" }));
  });
});

describe("atob", () => {
  it("round-trips every byte value", () => {
    const binary = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join("");
    expect(atob(btoa(binary))).toBe(binary);
    expect(atob(globalThis.btoa(binary))).toBe(binary);
  });

  it("accepts missing padding and ignores whitespace like the platform", () => {
    expect(atob("Zm9v\nYg")).toBe("foob");
    expect(atob("Zm8")).toBe("fo");
  });

  it.each(["Zm9vY", "Zm9v!", "Zm=9", "Zm9vé", "="])(
    "throws InvalidCharacterError for %j",
    (text) => {
      expect(() => globalThis.atob(text)).toThrow();
      expect(() => atob(text)).toThrow(expect.objectContaining({ name: "InvalidCharacterError" }));
    },
  );
});
