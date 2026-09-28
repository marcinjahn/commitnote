import { describe, expect, it } from "vitest";
import {
  fromBase64,
  fromBase64Url,
  toBase64,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from "./base64";

const byteInputs: readonly Uint8Array[] = [
  new Uint8Array([]),
  new Uint8Array([0x61]),
  new Uint8Array([0x61, 0x62]),
  new Uint8Array([0x61, 0x62, 0x63]),
  new Uint8Array([0, 1, 2, 253, 254, 255]),
];

describe("toBase64 / fromBase64", () => {
  it.each(byteInputs.map((bytes) => [bytes]))(
    "round-trips %j",
    (bytes: Uint8Array) => {
      const encoded = toBase64(bytes);
      expect(fromBase64(encoded)).toEqual(bytes);
    },
  );

  it("encodes known vectors with padding", () => {
    expect(toBase64(new Uint8Array([]))).toBe("");
    expect(toBase64(new Uint8Array([0x61]))).toBe("YQ==");
    expect(toBase64(new Uint8Array([0x61, 0x62]))).toBe("YWI=");
    expect(toBase64(new Uint8Array([0x61, 0x62, 0x63]))).toBe("YWJj");
  });

  it("rejects wrong length", () => {
    expect(() => fromBase64("A")).toThrow();
    expect(() => fromBase64("AB")).toThrow();
    expect(() => fromBase64("ABC")).toThrow();
  });

  it("rejects whitespace", () => {
    expect(() => fromBase64("YQ ==")).toThrow();
    expect(() => fromBase64("YQ==\n")).toThrow();
    expect(() => fromBase64(" YQ==")).toThrow();
  });

  it("rejects non-standard-alphabet characters", () => {
    expect(() => fromBase64("YW-j")).toThrow();
    expect(() => fromBase64("YW_j")).toThrow();
  });

  it("rejects misplaced or excess padding", () => {
    expect(() => fromBase64("Y===")).toThrow();
    expect(() => fromBase64("=QI=")).toThrow();
    expect(() => fromBase64("YQA=A===")).toThrow();
  });

  it("rejects non-canonical encodings", () => {
    // Same decoded byte (0x00) as "AA==" but with non-zero padding bits set.
    expect(() => fromBase64("AB==")).toThrow();
  });
});

describe("toBase64Url / fromBase64Url", () => {
  it.each(byteInputs.map((bytes) => [bytes]))(
    "round-trips %j",
    (bytes: Uint8Array) => {
      const encoded = toBase64Url(bytes);
      expect(fromBase64Url(encoded)).toEqual(bytes);
    },
  );

  it("uses the URL-safe alphabet with no padding", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(fromBase64Url(encoded)).toEqual(bytes);
  });

  it("rejects padding characters", () => {
    expect(() => fromBase64Url("YQ==")).toThrow();
  });

  it("rejects standard-alphabet characters", () => {
    expect(() => fromBase64Url("YW+j")).toThrow();
    expect(() => fromBase64Url("YW/j")).toThrow();
  });

  it("rejects a length that is 1 mod 4", () => {
    expect(() => fromBase64Url("A")).toThrow();
    expect(() => fromBase64Url("AAAAA")).toThrow();
  });

  it("rejects whitespace", () => {
    expect(() => fromBase64Url("YQ_j ")).toThrow();
  });

  it("rejects non-canonical encodings", () => {
    expect(() => fromBase64Url("AB")).toThrow();
  });
});

describe("utf8Encode / utf8Decode", () => {
  it("round-trips ASCII and multi-byte text", () => {
    const text = "git-notes éè 🔒";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("throws on invalid UTF-8", () => {
    expect(() => utf8Decode(new Uint8Array([0xff, 0xfe]))).toThrow();
  });
});
