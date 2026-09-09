import { describe, expect, it } from "vitest";
import type { RandomSource } from "../crypto/random";
import {
  createTrashEntryId,
  parseTrashEntryId,
  withTrashEntryDepth,
} from "./trash-entry-id";

const fixedRandom =
  (byte: number): RandomSource =>
  (length) =>
    new Uint8Array(length).fill(byte);

const SEPT_30 = Date.UTC(2026, 8, 30, 15, 43, 58);

describe("createTrashEntryId", () => {
  it("formats UTC time, depth and an 8-character base32 suffix", () => {
    expect(createTrashEntryId(SEPT_30, 2, fixedRandom(0))).toBe(
      "20260930T154358Z-2-aaaaaaaa",
    );
    expect(createTrashEntryId(SEPT_30, 1, fixedRandom(0xff))).toBe(
      "20260930T154358Z-1-77777777",
    );
  });

  it("uses secure randomness by default so ids at the same second differ", () => {
    const a = createTrashEntryId(SEPT_30, 1);
    const b = createTrashEntryId(SEPT_30, 1);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^20260930T154358Z-1-[a-z2-7]{8}$/);
  });

  it("rejects a depth that is not a positive integer", () => {
    expect(() => createTrashEntryId(SEPT_30, 0, fixedRandom(0))).toThrow(
      RangeError,
    );
    expect(() => createTrashEntryId(SEPT_30, 1.5, fixedRandom(0))).toThrow(
      RangeError,
    );
  });

  it("sorts lexicographically in deletion-time order", () => {
    const times = [
      Date.UTC(2027, 0, 1, 0, 0, 0),
      Date.UTC(2026, 8, 30, 9, 5, 7),
      Date.UTC(2026, 11, 31, 23, 59, 59),
      Date.UTC(2026, 8, 30, 10, 0, 0),
    ];
    const ids = times.map((time, i) =>
      createTrashEntryId(time, 9 - i, fixedRandom(255 - i)),
    );
    const byTime = [...ids].sort(
      (a, b) =>
        parseTrashEntryId(a)!.deletedAt - parseTrashEntryId(b)!.deletedAt,
    );
    expect([...ids].sort()).toEqual(byTime);
  });
});

describe("parseTrashEntryId", () => {
  it("round-trips deletion time (to the second) and depth", () => {
    const id = createTrashEntryId(SEPT_30 + 789, 12, fixedRandom(0x5a));
    expect(parseTrashEntryId(id)).toEqual({ deletedAt: SEPT_30, depth: 12 });
  });

  it.each([
    "",
    "not-an-id",
    "20260930T154358Z-2",
    "20260930T154358Z-0-aaaaaaaa",
    "20260930T154358Z-02-aaaaaaaa",
    "20260930T154358Z-x-aaaaaaaa",
    "20260930T154358Z-2-aaaaaaa",
    "20260930T154358Z-2-aaaaaaaaa",
    "20260930T154358Z-2-AAAAAAAA",
    "20260930T154358Z-2-aaaaaaa1",
    "20260930T154358-2-aaaaaaaa",
    "2026-09-30T154358Z-2-aaaaaaaa",
    "20261330T154358Z-2-aaaaaaaa",
    "20260231T154358Z-2-aaaaaaaa",
    "20260930T244358Z-2-aaaaaaaa",
    "20260930T156058Z-2-aaaaaaaa",
    " 20260930T154358Z-2-aaaaaaaa",
  ])("rejects malformed id %j", (id) => {
    expect(parseTrashEntryId(id)).toBeNull();
  });
});

describe("withTrashEntryDepth", () => {
  it("replaces only the depth, keeping time and suffix", () => {
    const id = withTrashEntryDepth("20260930T154358Z-2-aaaa2222", 13);
    expect(id).toBe("20260930T154358Z-13-aaaa2222");
    expect(parseTrashEntryId(id)).toEqual({ deletedAt: SEPT_30, depth: 13 });
  });

  it("rejects a malformed id or depth", () => {
    expect(() => withTrashEntryDepth("nope", 1)).toThrow(RangeError);
    expect(() =>
      withTrashEntryDepth("20260930T154358Z-2-aaaaaaaa", 0),
    ).toThrow(RangeError);
  });
});
