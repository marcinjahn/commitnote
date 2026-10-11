import { beforeAll, describe, expect, it } from "vitest";
import { sampleNotesRepoKeyring } from "../testing/sample-notes-repo/sample-notes-repo-keyring";
import { createSeededRandom } from "../testing/sample-notes-repo/seeded-random";
import { decodeDeviceTrailer, encodeDeviceTrailer, readDeviceTrailer } from "./device-trailer";

let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  key = (await sampleNotesRepoKeyring()).contentKey;
  otherKey = (await sampleNotesRepoKeyring()).nameKey;
});

function message(...values: string[]): string {
  return [
    "commitnote: save",
    "",
    "Commitnote-Format: 1",
    ...values.map((value) => `Commitnote-Device: ${value}`),
  ].join("\n");
}

describe("device trailer codec", () => {
  it("round-trips names including unicode and the middle dot", async () => {
    for (const name of ["Chrome · Linux", "Zażółć gęślą 🚀", "Phone"]) {
      const token = await encodeDeviceTrailer(name, key);
      expect(await decodeDeviceTrailer(token, key)).toBe(name);
    }
  });

  it("produces a single-line base64url token", async () => {
    const token = await encodeDeviceTrailer("Chrome · Linux", key);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is deterministic for a seeded random source and varies otherwise", async () => {
    const a = await encodeDeviceTrailer("Laptop", key, createSeededRandom(7));
    const b = await encodeDeviceTrailer("Laptop", key, createSeededRandom(7));
    expect(a).toBe(b);
    expect(await encodeDeviceTrailer("Laptop", key)).not.toBe(
      await encodeDeviceTrailer("Laptop", key),
    );
  });

  it("returns null for a wrong key", async () => {
    const token = await encodeDeviceTrailer("Laptop", key);
    expect(await decodeDeviceTrailer(token, otherKey)).toBeNull();
  });

  it("returns null for malformed, empty, truncated and tampered values", async () => {
    const token = await encodeDeviceTrailer("Laptop", key);
    const flipped = (token[10] === "A" ? "B" : "A");
    const tampered = token.slice(0, 10) + flipped + token.slice(11);
    for (const value of ["", "!!not base64!!", "a", token.slice(0, 20), token.slice(0, -4), tampered, `${token}=`]) {
      expect(await decodeDeviceTrailer(value, key)).toBeNull();
    }
  });

  it("returns null when the decrypted name normalizes to nothing", async () => {
    const token = await encodeDeviceTrailer("   ", key);
    expect(await decodeDeviceTrailer(token, key)).toBeNull();
  });
});

describe("readDeviceTrailer", () => {
  it("reads the trailer from a commit message", async () => {
    const token = await encodeDeviceTrailer("Laptop", key);
    expect(await readDeviceTrailer(message(token), key)).toBe("Laptop");
  });

  it("returns null without a trailer", async () => {
    expect(await readDeviceTrailer(message(), key)).toBeNull();
    expect(await readDeviceTrailer("", key)).toBeNull();
  });

  it("takes the last trailer when there are several", async () => {
    const first = await encodeDeviceTrailer("First", key);
    const second = await encodeDeviceTrailer("Second", key);
    expect(await readDeviceTrailer(message(first, second), key)).toBe("Second");
  });

  it("returns null for an undecodable trailer", async () => {
    expect(await readDeviceTrailer(message("garbage"), key)).toBeNull();
  });
});
