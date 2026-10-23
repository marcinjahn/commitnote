import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeDeviceTrailer } from "../../src/changes/device-trailer";
import { argon2idDirect } from "../../src/crypto/argon2";
import { utf8Decode, utf8Encode } from "../../src/crypto/base64";
import { decryptImage } from "../../src/crypto/image-cipher";
import { computeKeyCheck, deriveKeyring } from "../../src/crypto/keyring";
import { decryptName, decryptPath } from "../../src/crypto/name-cipher";
import { decryptNote } from "../../src/crypto/note-cipher";
import { padmeLength } from "../../src/crypto/padme";
import { isImageId } from "../../src/images/image-id";
import { openShare, openShareImage } from "../../src/share/share-envelope";
import {
  DEVICE_NAMES,
  KEYRING_A_PARAMS,
  KEYRING_PASSPHRASE,
  KEYRING_SALT,
  NAME_150_BYTES,
  NAME_INPUTS,
  PADME_LENGTHS,
  PATH_INPUTS,
  SHARE_CASES,
  TEST_IMAGES,
  fromHex,
  generateTestVectors,
  memoizeArgon2id,
  toHex,
} from "./generate-test-vectors";

const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/test-vectors",
);

const argon2id = memoizeArgon2id(argon2idDirect);

let generated: Promise<Record<string, unknown>> | undefined;
function regenerate(): Promise<Record<string, unknown>> {
  generated ??= generateTestVectors(argon2id);
  return generated;
}

async function committed(file: string): Promise<any> {
  return JSON.parse(await readFile(resolve(directory, file), "utf8"));
}

const keyringA = deriveKeyring(
  KEYRING_PASSPHRASE,
  { algorithm: "argon2id", salt: KEYRING_SALT, ...KEYRING_A_PARAMS },
  argon2id,
);

const FILES = [
  "argon2id.json",
  "primitives.json",
  "keyring.json",
  "names.json",
  "notes.json",
  "images.json",
  "image-pipeline.json",
  "device-trailer.json",
  "shares.json",
  "git-blob-sha1.json",
];

describe("test vectors", () => {
  it("regenerate to exactly the committed files", async () => {
    const files = await regenerate();
    expect(Object.keys(files).sort()).toEqual([...FILES].sort());
    for (const file of FILES) {
      const value = files[file] as { format: number };
      expect(value.format).toBe(1);
      expect(await committed(file)).toEqual(JSON.parse(JSON.stringify(value)));
    }
  });

  it("pins the keyring key checks", async () => {
    const { vectors } = await committed("keyring.json");
    expect(vectors.map((v: { name: string }) => v.name)).toEqual(["A", "B"]);
    expect(vectors[0].keyCheck).toBe(
      "Fwgxw4kavCNV6MMT02X5Wx8gjuC5vuoOCV9+6uo7Fbc=",
    );
    expect(vectors[1].keyCheck).toBe(
      "WgUuEkO4WJjQFMU5eGhGmNL9wAuFfycTjIbYTbIYsX0=",
    );
    expect(await computeKeyCheck(await keyringA)).toBe(vectors[0].keyCheck);
  });

  it("pins the Argon2id outputs to the keyring master secrets", async () => {
    const argon = await committed("argon2id.json");
    const { vectors } = await committed("keyring.json");
    const byName = new Map<string, string>(
      argon.vectors.map((v: { name: string; outputHex: string }) => [
        v.name,
        v.outputHex,
      ]),
    );
    expect(vectors[0].masterSecretHex).toBe(byName.get("reduced-ascii"));
    expect(vectors[1].masterSecretHex).toBe(byName.get("default"));
    expect(argon.vectors.map((v: { name: string }) => v.name)).toEqual([
      "reduced-ascii",
      "reduced-non-ascii",
      "default",
    ]);
  });

  it("round-trips names and paths", async () => {
    const keyring = await keyringA;
    const file = await committed("names.json");
    expect(file.segments.map((s: { name: string }) => s.name)).toEqual(
      NAME_INPUTS,
    );
    expect(utf8Encode(NAME_150_BYTES).length).toBe(150);
    for (const { name, segment } of file.segments) {
      expect(await decryptName(keyring, segment)).toBe(name.normalize("NFC"));
    }
    for (const [index, { path, storedPath }] of file.paths.entries()) {
      expect(path).toEqual(PATH_INPUTS[index]);
      expect(await decryptPath(keyring, storedPath)).toEqual(path);
    }
  });

  it("round-trips notes and indexes", async () => {
    const keyring = await keyringA;
    const file = await committed("notes.json");
    for (const note of file.notes) {
      expect(await decryptNote(keyring, note.stored)).toBe(note.markdown);
      expect(note.randomHex).toHaveLength(24);
    }
    expect(file.indexes.map((i: { kind: string }) => i.kind)).toEqual([
      "order",
      "tags",
      "images",
      "shares",
    ]);
    for (const index of file.indexes) {
      expect(await decryptNote(keyring, index.stored)).toBe(index.serialized);
      expect(JSON.parse(index.serialized).version).toBe(1);
    }
  });

  it("round-trips images and padme lengths", async () => {
    const keyring = await keyringA;
    const file = await committed("images.json");
    expect(file.padme.map((p: { length: number }) => p.length)).toEqual(
      PADME_LENGTHS,
    );
    for (const { length, padded } of file.padme) {
      expect(padmeLength(length)).toBe(padded);
    }
    expect(file.images).toHaveLength(TEST_IMAGES.length);
    for (const image of file.images) {
      expect(isImageId(image.imageId)).toBe(true);
      const payload = await decryptImage(
        keyring,
        image.imageId,
        fromHex(image.envelopeHex),
      );
      expect(payload.type).toBe(image.type);
      expect(payload.width).toBe(image.width);
      expect(payload.height).toBe(image.height);
      expect(toHex(payload.bytes)).toBe(image.bytesHex);
    }
  });

  it("round-trips device trailers", async () => {
    const keyring = await keyringA;
    const file = await committed("device-trailer.json");
    expect(file.trailers.map((t: { name: string }) => t.name)).toEqual(
      DEVICE_NAMES,
    );
    for (const { name, value } of file.trailers) {
      expect(await decodeDeviceTrailer(value, keyring.contentKey)).toBe(name);
    }
  });

  it("opens every share with its link secret and password", async () => {
    const file = await committed("shares.json");
    expect(file.shares.map((s: { name: string }) => s.name)).toEqual(
      SHARE_CASES.map((c) => c.name),
    );
    for (const share of file.shares) {
      const { input } = share;
      const opened = await openShare(
        share.envelope,
        input.linkSecret,
        input.password ?? undefined,
        argon2id,
      );
      expect(opened.note.name).toBe(input.name);
      expect(opened.note.markdown).toBe(input.markdown);
      expect(opened.note.sharedAt).toBe(input.sharedAt);
      expect(opened.note.updatedAt).toBe(input.updatedAt);
      expect(opened.note.images.map((i) => i.imageId)).toEqual(
        input.images.map((i: { imageId: string }) => i.imageId),
      );
      expect(share.imageFiles).toHaveLength(input.images.length);
      for (const [index, image] of input.images.entries()) {
        const payload = await openShareImage(
          opened.shareKey,
          index,
          share.imageFiles[index],
        );
        expect(payload.type).toBe(image.type);
        expect(payload.width).toBe(image.width);
        expect(payload.height).toBe(image.height);
        expect(toHex(payload.bytes)).toBe(image.bytesHex);
      }
    }
  });

  it("hashes git blobs", async () => {
    const { vectors } = await committed("git-blob-sha1.json");
    expect(vectors[0].sha).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    expect(vectors[1].sha).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    const notes = await committed("notes.json");
    expect(utf8Decode(fromHex(vectors[3].contentHex))).toBe(
      notes.notes[1].stored,
    );
  });

  it("covers every primitive with empty and non-empty inputs", async () => {
    const file = await committed("primitives.json");
    expect(file.aesGcm.length).toBeGreaterThanOrEqual(3);
    expect(file.hkdfSha256.length).toBeGreaterThanOrEqual(3);
    expect(file.hmacSha256.length).toBeGreaterThanOrEqual(3);
    expect(file.sha1.length).toBeGreaterThanOrEqual(3);
    expect(file.sha256.length).toBeGreaterThanOrEqual(3);
    expect(file.aesGcm.some((v: any) => v.plaintextHex === "")).toBe(true);
    expect(file.aesGcm.some((v: any) => v.aadHex === "")).toBe(true);
    expect(file.hkdfSha256.some((v: any) => v.saltHex === "")).toBe(true);
    expect(file.sha1.some((v: any) => v.dataHex === "")).toBe(true);
    expect(file.sha256.some((v: any) => v.dataHex === "")).toBe(true);
    expect(file.sha256[1].digestHex).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
