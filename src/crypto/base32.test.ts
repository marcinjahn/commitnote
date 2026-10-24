import { describe, expect, it } from "vitest";
import { encodeBase32 } from "./base32";

const encoder = new TextEncoder();

describe("encodeBase32", () => {
  it.each([
    ["", ""],
    ["f", "my"],
    ["fo", "mzxq"],
    ["foo", "mzxw6"],
    ["foob", "mzxw6yq"],
    ["fooba", "mzxw6ytb"],
    ["foobar", "mzxw6ytboi"],
  ])("encodes %j as %j", (input, expected) => {
    expect(encodeBase32(encoder.encode(input))).toBe(expected);
  });

  it("encodes 16 bytes as 26 characters", () => {
    expect(encodeBase32(new Uint8Array(16).fill(0xff))).toBe(`${"7".repeat(25)}4`);
  });
});
