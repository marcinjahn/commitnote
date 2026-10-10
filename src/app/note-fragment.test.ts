import { beforeAll, describe, expect, it } from "vitest";
import type { Keyring } from "../crypto/keyring";
import { testKeyring } from "../crypto/testing/test-keyring";
import {
  decodeNotePath,
  encodeNotePath,
  isNoteFragment,
  noteFragmentOf,
  storedPathOfFragment,
} from "./note-fragment";

let keyring: Keyring;

beforeAll(async () => {
  keyring = await testKeyring();
});

describe("isNoteFragment", () => {
  it("detects the note prefix", () => {
    expect(isNoteFragment("#n=abc")).toBe(true);
    expect(isNoteFragment("#n=")).toBe(true);
  });

  it("does not match share hashes or other hashes", () => {
    expect(isNoteFragment("#share=abc")).toBe(false);
    expect(isNoteFragment("")).toBe(false);
    expect(isNoteFragment("#note=abc")).toBe(false);
    expect(isNoteFragment("n=abc")).toBe(false);
  });

  it("produces fragments that are never share hashes", () => {
    expect(noteFragmentOf("abc").startsWith("#share=")).toBe(false);
  });
});

describe("storedPathOfFragment", () => {
  it("returns the stored path of a well-formed fragment", () => {
    expect(storedPathOfFragment("#n=aB3_-x")).toBe("aB3_-x");
    expect(storedPathOfFragment("#n=abc/def/g_h")).toBe("abc/def/g_h");
  });

  it.each([
    ["empty", "#n="],
    ["percent-encoded slash", "#n=abc%2Fdef"],
    ["space", "#n=abc def"],
    ["double slash", "#n=abc//def"],
    ["trailing slash", "#n=abc/"],
    ["leading slash", "#n=/abc"],
    ["not a note fragment", "#share=abc"],
    ["no hash", ""],
  ])("returns null for %s", (_label, hash) => {
    expect(storedPathOfFragment(hash)).toBeNull();
  });

  it("round-trips through noteFragmentOf", () => {
    expect(storedPathOfFragment(noteFragmentOf("abc/def"))).toBe("abc/def");
  });
});

describe("encodeNotePath / decodeNotePath", () => {
  it.each([
    [["note.md"]],
    [["Projekty", "Zażółć gęślą jaźń", "Łódź notatki.md"]],
  ])("round-trips %j", async (path) => {
    const storedPath = await encodeNotePath(keyring, path);
    expect(storedPathOfFragment(noteFragmentOf(storedPath))).toBe(storedPath);
    expect(await decodeNotePath(keyring, storedPath)).toEqual(path);
  });

  it("keeps plaintext out of the fragment", async () => {
    const path = ["Secret folder", "plan.md"];
    const fragment = noteFragmentOf(await encodeNotePath(keyring, path));
    for (const name of [...path, "Secret", "plan"]) {
      expect(fragment).not.toContain(name);
    }
  });

  it("rejects an empty path or segment", async () => {
    await expect(encodeNotePath(keyring, [])).rejects.toThrow(RangeError);
    await expect(encodeNotePath(keyring, ["a", ""])).rejects.toThrow(RangeError);
  });

  it("returns null for the wrong keyring", async () => {
    const storedPath = await encodeNotePath(keyring, ["a", "b.md"]);
    const other = await testKeyring("another passphrase", 9);
    expect(await decodeNotePath(other, storedPath)).toBeNull();
  });

  it("returns null for garbage and for the empty path", async () => {
    expect(await decodeNotePath(keyring, "abc")).toBeNull();
    expect(await decodeNotePath(keyring, "")).toBeNull();
  });
});
