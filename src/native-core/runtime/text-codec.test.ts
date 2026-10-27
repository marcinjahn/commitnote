import { describe, expect, it } from "vitest";
import { TextDecoder, TextEncoder } from "./text-codec";

const encoder = new TextEncoder();

describe("TextEncoder", () => {
  it.each(["", "ascii", "zażółć gęślą jaźń", "€ 日本語", "emoji 😀 𝒳 end"])(
    "matches the platform encoding of %j",
    (text) => {
      expect([...encoder.encode(text)]).toEqual([
        ...new globalThis.TextEncoder().encode(text),
      ]);
    },
  );

  it("replaces lone surrogates with U+FFFD", () => {
    expect([...encoder.encode("a\ud800b\udc00")]).toEqual([
      ...new globalThis.TextEncoder().encode("a\ud800b\udc00"),
    ]);
  });
});

describe("TextDecoder", () => {
  it("round-trips including astral characters", () => {
    const text = "aé€😀𝒳\u0000z";
    expect(new TextDecoder().decode(encoder.encode(text))).toBe(text);
  });

  it("decodes views with an offset and array buffers", () => {
    const bytes = new globalThis.TextEncoder().encode("xxhélloxx");
    expect(new TextDecoder().decode(bytes.subarray(2, 8))).toBe("héllo");
    expect(new TextDecoder().decode(bytes.slice().buffer)).toBe("xxhélloxx");
  });

  const invalid: [string, number[]][] = [
    ["lone continuation", [0x80]],
    ["truncated sequence", [0xe2, 0x82]],
    ["overlong", [0xc0, 0xaf]],
    ["surrogate", [0xed, 0xa0, 0x80]],
    ["above U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
    ["bad byte after lead", [0xe2, 0x28, 0xa1]],
    ["0xff", [0xff]],
  ];

  it.each(invalid)("throws TypeError for %s when fatal", (_label, bytes) => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    expect(() => decoder.decode(Uint8Array.from(bytes))).toThrow(TypeError);
  });

  it.each(invalid)("replaces %s like the platform when not fatal", (_label, bytes) => {
    const input = Uint8Array.from([0x61, ...bytes, 0x62]);
    expect(new TextDecoder().decode(input)).toBe(
      new globalThis.TextDecoder().decode(input),
    );
  });

  it("strips a leading BOM unless ignoreBOM is set", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]);
    expect(new TextDecoder().decode(bytes)).toBe("a");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      "﻿a",
    );
  });

  it("decodes large inputs", () => {
    const text = "ab😀".repeat(50_000);
    expect(new TextDecoder().decode(encoder.encode(text))).toBe(text);
  });

  it("rejects other encodings", () => {
    expect(() => new TextDecoder("latin1")).toThrow(RangeError);
  });
});
